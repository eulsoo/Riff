import { useState, useEffect, useCallback } from 'react';
import {
  CalendarMetadata,
  getCalendarMetadata,
  saveLocalCalendarMetadata,
  saveCalendarMetadata,
  normalizeCalendarUrl,
  fetchCalendarMetadataFromDB,
  saveCalendarMetadataToDB,
  deleteCalendarMetadataFromDB,
} from '../services/api';

export const useCalendarMetadata = () => {
  const [calendarMetadata, setCalendarMetadata] = useState<CalendarMetadata[]>([]);
  const [visibleCalendarUrlSet, setVisibleCalendarUrlSet] = useState<Set<string>>(new Set());

  // ── 초기 로드: localStorage(즉시) → DB(비동기 병합) ─────────
  useEffect(() => {
    // 1. localStorage에서 즉시 UI 렌더링 (깜빡임 없음)
    const metaMap = getCalendarMetadata();
    const localList = Object.values(metaMap);

    // 사용자 ID 기반 기본 캘린더 초기화 여부 확인
    // 이 플래그는 USER_SCOPED_LS_KEYS에 포함되지 않으므로 로그아웃 후에도 유지됨
    // → 사용자가 한 번 기본 캘린더를 삭제하면 재로그인 시 다시 생기지 않음
    const currentUserId = localStorage.getItem('riff_current_user_id');
    const defaultsKey = currentUserId ? `riff_defaults_init_${currentUserId}` : null;
    const defaultsAlreadyDone = defaultsKey ? localStorage.getItem(defaultsKey) === '1' : false;

    if (!defaultsAlreadyDone) {
      // 기본 로컬 캘린더 없으면 추가
      const localExists = localList.some(c => c.url === 'local');
      if (!localExists) {
        const defaultCal: CalendarMetadata = {
          url: 'local',
          displayName: '미팅',
          color: '#3b82f6',
          isVisible: true,
          isLocal: true,
          type: 'local',
        };
        localList.push(defaultCal);
        saveLocalCalendarMetadata(localList);
      }

      // 기본 공휴일 구독 캘린더 없으면 추가
      const KOREA_HOLIDAYS_URL = 'https://calendars.apple.com/subscriptions/holidays/ko_KR.ics';
      const holidayExists = localList.some(c =>
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
        localList.push(holidayCal);
        saveCalendarMetadata(localList.filter(c => !c.isLocal));
      }

      // 초기화 완료 마킹 (사용자별, 로그아웃 후에도 유지)
      if (defaultsKey) {
        localStorage.setItem(defaultsKey, '1');
      }
    }

    setCalendarMetadata(localList);

    const visible = new Set(
      localList
        .filter(c => c.isVisible !== false)
        .map(c => normalizeCalendarUrl(c.url))
        .filter((url): url is string => !!url)
    );
    if (!visible.has('local')) visible.add('local');
    setVisibleCalendarUrlSet(visible);

    // 2. DB에서 비동기로 최신 데이터 가져와서 병합
    // isMounted guard: 언마운트 후 Promise resolve 시 setState 호출 방지
    let isMounted = true;

    fetchCalendarMetadataFromDB().then(dbList => {
      if (!isMounted) return;

      if (dbList.length === 0) {
        // DB에 데이터가 없으면 → localStorage 데이터를 DB로 마이그레이션
        if (localList.length > 0) {
          saveCalendarMetadataToDB(localList).catch(console.error);
        }
        return;
      }

      // DB 데이터 기준으로 최종 목록 구성
      // (DB가 진짜 소스이므로 DB를 우선, localStorage에만 있는 임시 항목은 병합)
      const dbUrlSet = new Set(dbList.map(c => normalizeCalendarUrl(c.url) || c.url));
      const localOnlyItems = localList.filter(c => {
        const norm = normalizeCalendarUrl(c.url) || c.url;
        return !dbUrlSet.has(norm);
      });

      const merged = [...dbList, ...localOnlyItems];

      setCalendarMetadata(merged);

      // localStorage 캐시도 DB 데이터로 갱신
      saveCalendarMetadata(merged.filter(c => !c.isLocal));
      saveLocalCalendarMetadata(merged);

      // visibleCalendarUrlSet도 DB 기준으로 재계산
      const dbVisible = new Set(
        merged
          .filter(c => c.isVisible !== false)
          .map(c => normalizeCalendarUrl(c.url))
          .filter((url): url is string => !!url)
      );
      if (!dbVisible.has('local')) dbVisible.add('local');
      setVisibleCalendarUrlSet(dbVisible);
    }).catch(err => {
      console.warn('[useCalendarMetadata] DB fetch failed, using localStorage:', err);
    });

    return () => { isMounted = false; };
  }, []);

  // ── localStorage + DB 동시 저장 헬퍼 ────────────────────────
  const persistAll = useCallback((list: CalendarMetadata[]) => {
    // localStorage 동기 저장 (즉시 반영)
    saveCalendarMetadata(list.filter(c => !c.isLocal));
    saveLocalCalendarMetadata(list);
    // DB 비동기 저장 (백그라운드)
    saveCalendarMetadataToDB(list).catch(err =>
      console.error('[useCalendarMetadata] DB save failed:', err)
    );
  }, []);

  const refreshMetadata = useCallback(() => {
    const metaMap = getCalendarMetadata();
    const metaList = Object.values(metaMap);
    setCalendarMetadata(metaList);
  }, []);

  // 서버 캘린더 목록과 비교하여 createdFromApp 플래그 정리
  const refreshMetadataWithServerList = useCallback((
    serverCalendarsOrUrls: { url: string; displayName?: string }[] | string[]
  ): Map<string, string> => {
    const urlRemap = new Map<string, string>();

    const serverCalendars: { url: string; displayName?: string }[] =
      serverCalendarsOrUrls.length > 0 && typeof serverCalendarsOrUrls[0] === 'string'
        ? (serverCalendarsOrUrls as string[]).map(url => ({ url }))
        : (serverCalendarsOrUrls as { url: string; displayName?: string }[]);

    const metaMap = getCalendarMetadata();
    const metaList = Object.values(metaMap);

    const serverPathMap = new Map<string, string>();
    const serverNameMap = new Map<string, string>();
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
          console.log(`캘린더 "${cal.displayName}" - Mac에서도 삭제 확인 → 완전히 로컬로 전환`);
          hasChanges = true;
          acc.push({ ...cal, createdFromApp: false, originalCalDAVUrl: undefined });
        } else {
          acc.push(cal);
        }
        return acc;
      }

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
          createdFromApp: cal.createdFromApp,
        });
      } catch (e) {
        exists = Array.from(serverPathMap.values()).some(serverUrl =>
          normalizeCalendarUrl(serverUrl) === normUrl
        );
        console.log(`[Metadata Check] Checking "${cal.displayName}" (fallback):`, { url: cal.url, existsInServer: exists });
      }

      if (exists) {
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
          } catch { /* 이름 갱신 실패시 원본 유지 */ }
        }
        acc.push(cal);
        return acc;
      }

      hasChanges = true;
      if (cal.createdFromApp) {
        const newLocalUrl = `local-restored-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log(`캘린더 "${cal.displayName}"이(가) 서버에서 삭제됨 - 로컬 캘린더로 전환 (${cal.url} → ${newLocalUrl})`);
        urlRemap.set(cal.url, newLocalUrl);
        const norm = normalizeCalendarUrl(cal.url);
        if (norm && norm !== cal.url) urlRemap.set(norm, newLocalUrl);

        acc.push({
          ...cal,
          url: newLocalUrl,
          createdFromApp: false,
          isLocal: true,
          type: 'local' as const,
          color: cal.color,
        });
      } else {
        console.log(`캘린더 "${cal.displayName}"이(가) 서버에서 삭제됨 - 목록에서 제거`);
      }

      return acc;
    }, [] as CalendarMetadata[]);

    // 항상 상태와 DB를 업데이트 (새로 추가된 CalDAV 캘린더도 반영되도록)
    persistAll(updatedList);
    setCalendarMetadata(updatedList);

    return urlRemap;
  }, [persistAll]);

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
      persistAll(next);
      return next;
    });
    setVisibleCalendarUrlSet(prev => new Set(prev).add(newCal.url));
    return newCal.url;
  }, [persistAll]);

  const updateLocalCalendar = useCallback((url: string, updates: Partial<CalendarMetadata>) => {
    setCalendarMetadata(prev => {
      const next = prev.map(c => c.url === url ? { ...c, ...updates } : c);
      persistAll(next);
      return next;
    });
  }, [persistAll]);

  const convertLocalToCalDAV = useCallback((oldUrl: string, newCalendar: CalendarMetadata) => {
    setCalendarMetadata(prev => {
      const filtered = prev.filter(c => c.url !== oldUrl);
      const next = [...filtered, { ...newCalendar, isLocal: false }];
      persistAll(next);
      // 구 로컬 URL은 DB에서도 삭제
      deleteCalendarMetadataFromDB(oldUrl).catch(console.error);
      return next;
    });
  }, [persistAll]);

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
        originalCalDAVUrl: normalizeCalendarUrl(oldUrl) || oldUrl,
      };
      const next = prev.map(c => c.url === oldUrl ? converted : c);
      persistAll(next);
      // 구 CalDAV URL은 DB에서도 삭제
      deleteCalendarMetadataFromDB(oldUrl).catch(console.error);
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
  }, [persistAll]);

  const deleteCalendar = useCallback((url: string) => {
    setCalendarMetadata(prev => {
      const next = prev.filter(c => c.url !== url);
      persistAll(next);
      return next;
    });
    // DB에서도 삭제
    deleteCalendarMetadataFromDB(url).catch(console.error);
    setVisibleCalendarUrlSet(prev => {
      const next = new Set(prev);
      next.delete(url);
      return next;
    });
  }, [persistAll]);

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
