import { useState, useEffect, useCallback } from 'react';
import { CalendarMetadata, getCalendarMetadata, saveLocalCalendarMetadata, normalizeCalendarUrl, saveCalendarMetadata } from '../services/api';
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

    // 첫 방문 시 Apple 한국 공휴일 구독 캘린더 기본 추가
    const KOREA_HOLIDAYS_URL = 'https://calendars.apple.com/subscriptions/holidays/ko_KR.ics';
    const holidayExists = metaList.some(c =>
      c.url === KOREA_HOLIDAYS_URL ||
      c.subscriptionUrl === KOREA_HOLIDAYS_URL ||
      c.url.includes('ko_KR') ||
      c.url.includes('holidays')
    );
    if (!holidayExists) {
      const holidayCal: CalendarMetadata = {
        url: KOREA_HOLIDAYS_URL,
        displayName: '대한민국 공휴일',
        color: '#ff3b30',
        isVisible: true,
        isLocal: false,
        isSubscription: true,
        type: 'subscription',
        subscriptionUrl: KOREA_HOLIDAYS_URL,
        readOnly: true,
      };
      metaList.push(holidayCal);
      // subscription 메타데이터 저장 (local 제외)
      saveCalendarMetadata(metaList.filter(c => !c.isLocal));
      visible.add(KOREA_HOLIDAYS_URL);
    }

    
    // Hardcoded holiday calendar Logic Removed

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
  // 반환값: Map<oldCalDAVUrl, newLocalUrl> — 로컬로 전환된 캘린더의 URL 변경 매핑
  // serverCalendarsOrUrls: { url, displayName? }[] 또는 string[]
  const refreshMetadataWithServerList = useCallback((
    serverCalendarsOrUrls: { url: string; displayName?: string }[] | string[]
  ): Map<string, string> => {
    const urlRemap = new Map<string, string>();

    // string[] 호환
    const serverCalendars: { url: string; displayName?: string }[] =
      serverCalendarsOrUrls.length > 0 && typeof serverCalendarsOrUrls[0] === 'string'
        ? (serverCalendarsOrUrls as string[]).map(url => ({ url }))
        : (serverCalendarsOrUrls as { url: string; displayName?: string }[]);

    const metaMap = getCalendarMetadata();
    const metaList = Object.values(metaMap);
    
    // 서버 URL 정규화 + 이름 매핑
    const serverPathMap = new Map<string, string>(); // pathname -> fullUrl
    const serverNameMap = new Map<string, string>(); // pathname -> displayName
    serverCalendars.forEach(({ url, displayName }) => {
        try {
            const urlObj = new URL(url);
            const cleanPath = decodeURIComponent(urlObj.pathname).replace(/\/+$/, '');
            serverPathMap.set(cleanPath, url);
            if (displayName) serverNameMap.set(cleanPath, displayName);
        } catch (e) {
            const norm = normalizeCalendarUrl(url);
            if (norm) serverPathMap.set(norm, url);
        }
    });
    
    console.log('[Metadata Check] Server Paths:', Array.from(serverPathMap.keys()));

    let hasChanges = false;
    const updatedList = metaList.reduce((acc, cal) => {
      const isHttp = cal.url.startsWith('http');

      // originalCalDAVUrl이 있는 로컬 캘린더 = 이전에 unsync된 캘린더
      // 원래 CalDAV URL이 서버에서도 삭제됐는지 추가 확인
      if (cal.isLocal && cal.originalCalDAVUrl && cal.createdFromApp) {
        let origExists = false;
        try {
          const origUrlObj = new URL(cal.originalCalDAVUrl);
          const origPath = decodeURIComponent(origUrlObj.pathname).replace(/\/+$/, '');
          origExists = serverPathMap.has(origPath);
        } catch {
          const norm = normalizeCalendarUrl(cal.originalCalDAVUrl);
          origExists = norm ? Array.from(serverPathMap.values()).some(u => normalizeCalendarUrl(u) === norm) : false;
        }

        if (!origExists) {
          // 서버에서도 삭제됨 → sync_disabled + iCloud 아이콘 제거, 완전히 로컬로
          console.log(`캘린더 "${cal.displayName}" - Mac에서도 삭제 확인 → 완전히 로컬로 전환`);
          hasChanges = true;
          acc.push({ ...cal, createdFromApp: false, originalCalDAVUrl: undefined });
        } else {
          // Mac에 아직 존재 → sync_disabled + iCloud 유지
          acc.push(cal);
        }
        return acc;
      }

      // 일반 로컬/구독 캘린더는 건드리지 않음
      if ((cal.isLocal && !isHttp) || cal.type === 'subscription' || cal.isSubscription) {
        acc.push(cal);
        return acc;
      }

      let exists = false;
      const normUrl = normalizeCalendarUrl(cal.url) || '';
      
      try {
          const calUrlObj = new URL(cal.url);
          const calCleanPath = decodeURIComponent(calUrlObj.pathname).replace(/\/+$/, '');
          exists = serverPathMap.has(calCleanPath);
          console.log(`[Metadata Check] Checking "${cal.displayName}":`, { 
              url: cal.url, 
              path: calCleanPath, 
              existsInServer: exists,
              createdFromApp: cal.createdFromApp
          });
      } catch (e) {
           exists = Array.from(serverPathMap.values()).some(serverUrl => 
              normalizeCalendarUrl(serverUrl) === normUrl
           );
           console.log(`[Metadata Check] Checking "${cal.displayName}" (fallback):`, { url: cal.url, existsInServer: exists });
      }

      if (exists) {
        // 서버에 존재: iCloud에서 이름을 바관 경우 Riff에도 반영
        // (단, createdFromApp 캘린더는 Riff에서 이름시키므로 덮어쓰지 않음)
        if (!cal.createdFromApp) {
          try {
            const calUrlObj2 = new URL(cal.url);
            const calPath2 = decodeURIComponent(calUrlObj2.pathname).replace(/\/+$/, '');
            const serverName = serverNameMap.get(calPath2);
            if (serverName && serverName !== cal.displayName) {
              hasChanges = true;
              acc.push({ ...cal, displayName: serverName });
              return acc;
            }
          } catch { /* fallback: 이름 갱신 실패시 원본 유지 */ }
        }
        acc.push(cal);
        return acc;
      }

      hasChanges = true;
      if (cal.createdFromApp) {
        const newLocalUrl = `local-restored-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log(`캘린더 "${cal.displayName}"이(가) 서버에서 삭제됨 - 로컬 캘린더로 전환 (${cal.url} → ${newLocalUrl})`);
        // 이벤트 re-link를 위해 URL 매핑 기록
        urlRemap.set(cal.url, newLocalUrl);
        // 정규화된 URL도 등록 (DB에 어떤 형태로 저장됐는지 불확실)
        const norm = normalizeCalendarUrl(cal.url);
        if (norm && norm !== cal.url) urlRemap.set(norm, newLocalUrl);

        acc.push({ 
          ...cal, 
          url: newLocalUrl,
          createdFromApp: false,
          isLocal: true,
          type: 'local' as const,
          color: cal.color
        });
      } else {
        console.log(`캘린더 "${cal.displayName}"이(가) 서버에서 삭제됨 - 목록에서 제거`);
      }
      
      return acc;
    }, [] as CalendarMetadata[]);
    
    if (hasChanges) {
      saveCalendarMetadata(updatedList);
      saveLocalCalendarMetadata(updatedList);
    }
    
    setCalendarMetadata(updatedList);
    return urlRemap;
  }, []);

  const toggleCalendarVisibility = useCallback((url: string) => {
      const normalizedUrl = normalizeCalendarUrl(url) || url;
      setVisibleCalendarUrlSet(prev => {
          const next = new Set(prev);
          if (next.has(normalizedUrl)) next.delete(normalizedUrl);
          else next.add(normalizedUrl);
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
      // 로컬 캘린더는 로컬 스토리지에, 비로컬(iCloud/구독) 캘린더는 CalDAV 스토리지에 저장
      const target = next.find(c => c.url === url);
      if (target?.isLocal) {
        saveLocalCalendarMetadata(next);
      } else {
        // iCloud CalDAV, 구독 캘린더 등 - CalDAV 메타데이터 스토리지에 저장
        saveCalendarMetadata(next.filter(c => !c.isLocal));
      }
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

  // CalDAV 캘린더 → 로컬 캘린더로 역변환 (동기화 해제 시)
  // createdFromApp: true + originalCalDAVUrl 을 유지해서
  //   - sync_disabled + iCloud 아이콘 표시
  //   - 나중에 서버 비교로 Mac에서도 삭제됐는지 감지 가능
  const convertCalDAVToLocal = useCallback((oldUrl: string): string => {
    const newLocalUrl = `local-unsynced-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setCalendarMetadata(prev => {
      const target = prev.find(c => c.url === oldUrl);
      if (!target) return prev;
      const converted: CalendarMetadata = {
        ...target,
        url: newLocalUrl,
        isLocal: true,
        type: 'local' as const,
        createdFromApp: true,
        originalCalDAVUrl: normalizeCalendarUrl(oldUrl) || oldUrl, // 서버 삭제 감지용
      };
      const next = prev.map(c => c.url === oldUrl ? converted : c);
      saveLocalCalendarMetadata(next);
      saveCalendarMetadata(next.filter(c => !c.isLocal));
      return next;
    });
    setVisibleCalendarUrlSet(prev => {
      const next = new Set(prev);
      next.delete(oldUrl);
      next.delete(normalizeCalendarUrl(oldUrl) || oldUrl);
      next.add(newLocalUrl);
      return next;
    });
    return newLocalUrl;
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
    setCalendarMetadata,
    visibleCalendarUrlSet,
    setVisibleCalendarUrlSet,
    toggleCalendarVisibility,
    addLocalCalendar,
    updateLocalCalendar,
    convertLocalToCalDAV,
    convertCalDAVToLocal,
    deleteCalendar,
    refreshMetadata,
    refreshMetadataWithServerList,
  };
};
