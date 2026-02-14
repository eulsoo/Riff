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
    // Default local calendar (if not exists)
    const localExists = metaList.some(c => c.url === 'local');
    if (!localExists) {
        const defaultCal: CalendarMetadata = {
            url: 'local',
            displayName: '미팅',
            color: '#3b82f6',
            isVisible: true,
            isLocal: true,
            type: 'local'
        };
        metaList.push(defaultCal);
        saveLocalCalendarMetadata(metaList); // Save all local calendars
    }
    
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

  // 서버 캘린더 목록과 비교하여 createdFromApp 플래그 정리
  // 서버에 더 이상 없는 캘린더의 createdFromApp 플래그 제거
  const refreshMetadataWithServerList = useCallback((serverCalendarUrls: string[]) => {
    const metaMap = getCalendarMetadata();
    const metaList = Object.values(metaMap);
    
    // 서버 URL 정규화 (pathname 기준)
    const serverPathMap = new Map<string, string>(); // pathname -> fullUrl
    serverCalendarUrls.forEach(url => {
        try {
            // URL 객체 생성 시도
            const urlObj = new URL(url);
            // pathname 끝의 슬래시 제거 및 디코딩
            const cleanPath = decodeURIComponent(urlObj.pathname).replace(/\/+$/, '');
            serverPathMap.set(cleanPath, url);
        } catch (e) {
            // URL 파싱 실패 시 원본 사용 (정규화만)
            const norm = normalizeCalendarUrl(url);
            if (norm) serverPathMap.set(norm, url);
        }
    });
    
    console.log('[Metadata Check] Server Paths:', Array.from(serverPathMap.keys()));

    let hasChanges = false;
    const updatedList = metaList.reduce((acc, cal) => {
      // 로컬 캘린더나 구독 캘린더는 건드리지 않음
      // 단, 로컬 캘린더라도 URL이 http/https이면 검증 대상에 포함 (잘못된 메타데이터 수정 위해) or converted ones
      const isHttp = cal.url.startsWith('http');
      if ((cal.isLocal && !isHttp) || cal.type === 'subscription' || cal.isSubscription) {
        acc.push(cal);
        return acc;
      }

      // CalDAV 캘린더 확인
      let exists = false;
      const normUrl = normalizeCalendarUrl(cal.url) || '';
      
      try {
          const calUrlObj = new URL(cal.url);
          // pathname 끝의 슬래시 제거 및 디코딩
          const calCleanPath = decodeURIComponent(calUrlObj.pathname).replace(/\/+$/, '');
          exists = serverPathMap.has(calCleanPath);
          console.log(`[Metadata Check] Checking "${cal.displayName}":`, { 
              url: cal.url, 
              path: calCleanPath, 
              existsInServer: exists,
              createdFromApp: cal.createdFromApp
          });
      } catch (e) {
          // URL 파싱 실패 시 단순 비교 fallback
           exists = Array.from(serverPathMap.values()).some(serverUrl => 
              normalizeCalendarUrl(serverUrl) === normUrl
           );
           console.log(`[Metadata Check] Checking "${cal.displayName}" (fallback):`, { url: cal.url, existsInServer: exists });
      }

      // 서버에 존재하는 경우 유지
      if (exists) {
        acc.push(cal);
        return acc;
      }

      // 서버에 없는 경우 처리
      hasChanges = true;
      if (cal.createdFromApp) {
        // 1. 앱에서 만든 캘린더: 로컬 캘린더로 전환 (데이터 보존)
        // URL도 로컬 형식으로 변경해야 함
        console.log(`캘린더 "${cal.displayName}"이(가) 서버에서 삭제됨 - 로컬 캘린더로 전환`);
        acc.push({ 
          ...cal, 
          url: `local-restored-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          createdFromApp: false,
          isLocal: true,
          type: 'local' as const,
          color: cal.color
        });
      } else {
        // 2. 일반 iCloud 캘린더: 목록에서 제거 (동기화 반영)
        console.log(`캘린더 "${cal.displayName}"이(가) 서버에서 삭제됨 - 목록에서 제거`);
        // acc.push(cal)을 하지 않음으로써 제거됨
      }
      
      return acc;
    }, [] as CalendarMetadata[]);
    
    if (hasChanges) {
      // 변경사항 저장
      saveCalendarMetadata(updatedList);
      saveLocalCalendarMetadata(updatedList);
    }
    
    setCalendarMetadata(updatedList);
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
    refreshMetadataWithServerList,
  };
};
