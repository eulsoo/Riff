import { useState, useEffect, useCallback } from 'react';
import { CalendarMetadata, getCalendarMetadata, saveLocalCalendarMetadata, normalizeCalendarUrl, saveCalendarMetadata, upsertEvent } from '../services/api';
import { fetchAndParseICS } from '../services/icsParser';

export const useCalendarMetadata = () => {
  const [calendarMetadata, setCalendarMetadata] = useState<CalendarMetadata[]>([]);
  const [visibleCalendarUrlSet, setVisibleCalendarUrlSet] = useState<Set<string>>(new Set());

  // --- Initial Load Metadata ---
  useEffect(() => {
    const metaMap = getCalendarMetadata();
    const metaList = Object.values(metaMap);
    setCalendarMetadata(metaList);
    
    // Explicit typing/filtering to avoid undefined in map
    const visible = new Set(
        metaList
        .filter(c => c.isVisible !== false)
        .map(c => normalizeCalendarUrl(c.url))
        .filter((url): url is string => !!url)
    );
    // Default local calendar
    if (!visible.has('local')) visible.add('local');
    
    // Check for South Korea Holidays (Apple iCloud)
    const HOLIDAY_CAL_URL = 'https://calendars.icloud.com/holidays/kr_ko.ics/';
    const normalizedHolidayUrl = normalizeCalendarUrl(HOLIDAY_CAL_URL);
    const synced = localStorage.getItem('holiday_synced_v2');

    if (normalizedHolidayUrl && (!visible.has(normalizedHolidayUrl) || !synced)) {
        // Add metadata immediately if missing
        if (!visible.has(normalizedHolidayUrl)) {
            const holidayMeta: CalendarMetadata = {
                url: HOLIDAY_CAL_URL, 
                displayName: '대한민국 공휴일(Apple)',
                color: '#EF4444',
                isVisible: true,
                isLocal: false,
                type: 'subscription',
                subscriptionUrl: HOLIDAY_CAL_URL
            };
            metaList.push(holidayMeta);
            visible.add(normalizedHolidayUrl);
            saveCalendarMetadata(metaList);
        }
        
        // Fetch and sync events in background
        const now = new Date();
        const start = new Date(now.getFullYear() - 1, 0, 1);
        const end = new Date(now.getFullYear() + 2, 11, 31);
        
        fetchAndParseICS(HOLIDAY_CAL_URL, start, end).then(events => {
            console.log(`Fetched ${events.length} holiday events`);
            if (events.length > 0) {
                events.forEach(ev => {
                    upsertEvent({
                        ...ev,
                        calendarUrl: normalizedHolidayUrl,
                        source: 'caldav' 
                    });
                });
                localStorage.setItem('holiday_synced_v2', 'true');
            }
        }).catch(err => console.error('Failed to sync holidays:', err));
    }

    // Update state
    setCalendarMetadata(metaList);
    setVisibleCalendarUrlSet(visible);
  }, []);

  const refreshMetadata = useCallback(() => {
    const metaMap = getCalendarMetadata();
    const metaList = Object.values(metaMap);
    setCalendarMetadata(metaList);

    // Re-calculate visible set if needed, or just keep existing set but filter by new list?
    // Usually visibility is separate, but we should ensure deleted calendars are removed from visibility set.
    // For now, simpler is just refreshing the list.
  }, []);

  const toggleCalendarVisibility = useCallback((url: string) => {
      setVisibleCalendarUrlSet(prev => {
          const next = new Set(prev);
          if (next.has(url)) next.delete(url);
          else next.add(url);
          return next;
      });
  }, []);

  const addLocalCalendar = useCallback((name: string, color: string) => {
    const newCal: CalendarMetadata = {
      url: `local-${Date.now()}`,
      displayName: name,
      color,
      isVisible: true,
      isLocal: true,
    };
    setCalendarMetadata(prev => {
      const next = [...prev, newCal];
      saveLocalCalendarMetadata(next);
      return next;
    });
    setVisibleCalendarUrlSet(prev => new Set(prev).add(newCal.url));
    return newCal.url;
  }, []);

  const updateLocalCalendar = useCallback((url: string, updates: Partial<CalendarMetadata>) => {
    setCalendarMetadata(prev => {
      const next = prev.map(c => c.url === url ? { ...c, ...updates } : c);
      saveLocalCalendarMetadata(next);
      return next;
    });
  }, []);

  // 로컬 캘린더를 CalDAV 캘린더로 변환
  const convertLocalToCalDAV = useCallback((oldUrl: string, newCalendar: CalendarMetadata) => {
    setCalendarMetadata(prev => {
      // 이전 로컬 캘린더 제거하고 새 CalDAV 캘린더 추가
      const filtered = prev.filter(c => c.url !== oldUrl);
      const next = [...filtered, { ...newCalendar, isLocal: false }];
      
      // 두 스토리지 모두 업데이트
      saveLocalCalendarMetadata(next);  // 로컬 캘린더에서 제거됨 (isLocal: false이므로)
      saveCalendarMetadata(next);       // CalDAV 캘린더에 추가됨
      
      return next;
    });
  }, []);

  const deleteCalendar = useCallback((url: string) => {
    setCalendarMetadata(prev => {
      const next = prev.filter(c => c.url !== url);
      // Save both stores (functions handle filtering internally)
      saveLocalCalendarMetadata(next);
      saveCalendarMetadata(next);
      return next;
    });
    setVisibleCalendarUrlSet(prev => {
        const next = new Set(prev);
        next.delete(url);
        return next;
    });
  }, []);

  return {
    calendarMetadata,
    visibleCalendarUrlSet,
    setVisibleCalendarUrlSet,
    toggleCalendarVisibility,
    addLocalCalendar,
    updateLocalCalendar,
    convertLocalToCalDAV,
    deleteCalendar,
    refreshMetadata,
  };
};
