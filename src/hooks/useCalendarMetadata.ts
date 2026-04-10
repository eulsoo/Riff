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
  batchDeleteCalendarMetadataFromDB,
  deleteCalendarMetadataFromLocalStorage,
  deleteEventsByCalendarUrl,
} from '../services/api';

export interface RefreshMetadataResult {
  urlRemap: Map<string, string>;
  /** iCloud→Riff 캘린더 (createdFromApp=false) 중 서버에서 삭제된 캘린더 이름 목록 */
  deletedCalendars: string[];
  /** Riff→iCloud 캘린더 (createdFromApp=true) 중 서버에서 삭제되어 로컬로 복원된 캘린더 이름 목록 */
  restoredCalendars: string[];
}

/** isVisible이 true인 캘린더 URL Set 생성 (local 기본 포함) */
const buildVisibleUrlSet = (list: CalendarMetadata[]): Set<string> => {
  const visible = new Set(
    list
      .filter(c => c.isVisible !== false)
      .map(c => normalizeCalendarUrl(c.url))
      .filter((url): url is string => !!url)
  );
  if (!visible.has('local')) visible.add('local');
  return visible;
};

/**
 * 같은 displayName을 가진 로컬/CalDAV(createdFromApp) 중복 항목 제거.
 * local-* URL을 CalDAV URL보다 우선 유지하고, 제거된 URL 목록을 반환.
 */
const deduplicateLocalCalendars = (list: CalendarMetadata[]): {
  result: CalendarMetadata[];
  removedUrls: string[];
} => {
  const nameToEntry = new Map<string, { cal: CalendarMetadata; idx: number }>();
  const toRemoveIndices = new Set<number>();
  const removedUrls: string[] = [];

  list.forEach((cal, idx) => {
    if ((!cal.isLocal && !cal.createdFromApp) || !cal.displayName) return;

    const existing = nameToEntry.get(cal.displayName);
    if (!existing) {
      nameToEntry.set(cal.displayName, { cal, idx });
      return;
    }

    const calIsHttp = cal.url.startsWith('http');
    const existingIsHttp = existing.cal.url.startsWith('http');

    if (!calIsHttp && existingIsHttp) {
      // 현재 항목(local-*)이 기존 항목(CalDAV)보다 우선 → 기존 제거
      toRemoveIndices.add(existing.idx);
      removedUrls.push(existing.cal.url);
      nameToEntry.set(cal.displayName, { cal, idx });
    } else {
      // 현재 항목이 중복 → 제거
      toRemoveIndices.add(idx);
      removedUrls.push(cal.url);
    }
  });

  return {
    result: list.filter((_, idx) => !toRemoveIndices.has(idx)),
    removedUrls,
  };
};

const GOOGLE_ORIGINAL_LOCAL_URL_MAP_KEY = 'googleOriginalLocalUrlMap';

const readGoogleOriginalLocalUrlMap = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(GOOGLE_ORIGINAL_LOCAL_URL_MAP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeGoogleOriginalLocalUrlMap = (map: Record<string, string>) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GOOGLE_ORIGINAL_LOCAL_URL_MAP_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
};

export const useCalendarMetadata = () => {
  const [calendarMetadata, setCalendarMetadata] = useState<CalendarMetadata[]>([]);
  const [visibleCalendarUrlSet, setVisibleCalendarUrlSet] = useState<Set<string>>(new Set());

  // ── 초기 로드: localStorage(즉시) → DB(비동기 병합 + 기본값 초기화) ─────────
  useEffect(() => {
    // 1. localStorage에서 즉시 UI 렌더링 (깜빡임 없음, 기본값 추가 없음)
    const metaMap = getCalendarMetadata();
    const localList = Object.values(metaMap);

    setCalendarMetadata(localList);
    setVisibleCalendarUrlSet(buildVisibleUrlSet(localList));

    // 2. DB에서 비동기로 최신 데이터 가져온 뒤 기본값 초기화 결정
    // isMounted guard: 언마운트 후 Promise resolve 시 setState 호출 방지
    let isMounted = true;

    fetchCalendarMetadataFromDB().then(dbList => {
      if (!isMounted) return;

      // 기본값 초기화 플래그 — DB 결과를 본 뒤에 판단해야 정확함
      const currentUserId = localStorage.getItem('riff_current_user_id');
      const defaultsKey = currentUserId ? `riff_defaults_init_${currentUserId}` : null;
      const defaultsAlreadyDone = defaultsKey ? localStorage.getItem(defaultsKey) === '1' : false;

      if (dbList.length > 0) {
        // ── 기존 사용자: DB 데이터가 있음 ──
        // 플래그가 없으면 설정 (코드 업데이트 이전에 가입한 사용자 포함)
        if (defaultsKey && !defaultsAlreadyDone) {
          localStorage.setItem(defaultsKey, '1');
        }

        // DB 데이터 기준으로 최종 목록 구성
        // 주의: 변환 직후 DB 저장이 완료되기 전에 이 콜백이 실행될 수 있음.
        // localStorage 최신값을 사용해 변환된 캘린더가 덮어쓰이지 않도록 함.
        const dbUrlSet = new Set(dbList.map(c => normalizeCalendarUrl(c.url) || c.url));
        const currentLocalMap = getCalendarMetadata();
        const currentLocalList = Object.values(currentLocalMap);
        const localOnlyItems = currentLocalList.filter(c => {
          const norm = normalizeCalendarUrl(c.url) || c.url;
          return !dbUrlSet.has(norm);
        });

        const { result: merged, removedUrls } = deduplicateLocalCalendars([...dbList, ...localOnlyItems]);
        batchDeleteCalendarMetadataFromDB(removedUrls).catch(console.error);

        setCalendarMetadata(merged);
        saveCalendarMetadata(merged.filter(c => !c.isLocal));
        saveLocalCalendarMetadata(merged);

        const dbVisible = new Set(
          merged
            .filter(c => c.isVisible !== false)
            .map(c => normalizeCalendarUrl(c.url))
            .filter((url): url is string => !!url)
        );
        if (!dbVisible.has('local')) dbVisible.add('local');
        setVisibleCalendarUrlSet(dbVisible);

      } else {
        // ── 신규 사용자 또는 DB가 비어있는 경우 ──
        if (!defaultsAlreadyDone) {
          // 진짜 신규 사용자: 기본 캘린더 추가 후 DB에 저장
          const newList = [...localList];

          const localExists = newList.some(c => c.url === 'local');
          if (!localExists) {
            newList.push({
              url: 'local',
              displayName: '미팅',
              color: '#3b82f6',
              isVisible: true,
              isLocal: true,
              type: 'local',
            });
          }

          const KOREA_HOLIDAYS_URL = 'https://calendars.apple.com/subscriptions/holidays/ko_KR.ics';
          const holidayExists = newList.some(c =>
            c.url === KOREA_HOLIDAYS_URL ||
            c.subscriptionUrl === KOREA_HOLIDAYS_URL ||
            c.url.includes('ko_KR') ||
            c.url.includes('holidays')
          );
          if (!holidayExists) {
            newList.push({
              url: KOREA_HOLIDAYS_URL,
              displayName: '대한민국 공휴일(Apple)',
              color: '#ff3b30',
              isVisible: true,
              isLocal: false,
              isSubscription: true,
              type: 'subscription',
              subscriptionUrl: KOREA_HOLIDAYS_URL,
              readOnly: true,
            });
          }

          saveCalendarMetadataToDB(newList).catch(console.error);
          saveCalendarMetadata(newList.filter(c => !c.isLocal));
          saveLocalCalendarMetadata(newList);
          setCalendarMetadata(newList);
          setVisibleCalendarUrlSet(buildVisibleUrlSet(newList));

          if (defaultsKey) localStorage.setItem(defaultsKey, '1');

        } else {
          // 플래그는 있지만 DB가 비어있음 → 사용자가 직접 전부 삭제한 것
          // 또는 localStorage에서 DB로 마이그레이션 필요
          const currentForMigration = Object.values(getCalendarMetadata());
          if (currentForMigration.length > 0) {
            saveCalendarMetadataToDB(currentForMigration).catch(console.error);
          }
        }
      }
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
  ): RefreshMetadataResult => {
    const urlRemap = new Map<string, string>();
    const deletedCalendars: string[] = [];
    const restoredCalendars: string[] = [];

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

    // DB에서 배치 삭제할 URL 목록 (루프 내 개별 삭제 → N+1 방지)
    const urlsToDeleteFromDB: string[] = [];

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

      // Google 캘린더는 CalDAV 서버 목록과 비교 대상이 아님 - 그대로 유지 (sync 배지 보존)
      if (cal.url.startsWith('google:')) {
        acc.push(cal);
        return acc;
      }

      let exists = false;
      const normUrl = normalizeCalendarUrl(cal.url) || '';

      try {
        const calUrlObj = new URL(cal.url);
        const calCleanPath = decodeURIComponent(calUrlObj.pathname).replace(/\/+$/, '');
        exists = serverPathMap.has(calCleanPath);
      } catch {
        exists = Array.from(serverPathMap.values()).some(serverUrl =>
          normalizeCalendarUrl(serverUrl) === normUrl
        );
      }

      if (exists) {
        if (!cal.createdFromApp) {
          try {
            const calUrlObj2 = new URL(cal.url);
            const calPath2 = decodeURIComponent(calUrlObj2.pathname).replace(/\/+$/, '');
            const serverName = serverNameMap.get(calPath2);
            if (serverName && serverName !== cal.displayName) {
              acc.push({ ...cal, displayName: serverName });
              return acc;
            }
          } catch { /* 이름 갱신 실패시 원본 유지 */ }
        }
        acc.push(cal);
        return acc;
      }

      if (cal.createdFromApp) {
        // 같은 displayName의 로컬 항목이 이미 acc에 있으면 해당 URL로 리맵만 하고 중복 생성 방지
        const existingLocal = acc.find(a => a.isLocal && a.displayName === cal.displayName);
        if (existingLocal) {
          urlRemap.set(cal.url, existingLocal.url);
          const norm = normalizeCalendarUrl(cal.url);
          if (norm && norm !== cal.url) urlRemap.set(norm, existingLocal.url);
          deleteCalendarMetadataFromLocalStorage(cal.url);
          urlsToDeleteFromDB.push(cal.url);
        } else {
          const newLocalUrl = `local-restored-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          urlRemap.set(cal.url, newLocalUrl);
          const norm = normalizeCalendarUrl(cal.url);
          if (norm && norm !== cal.url) urlRemap.set(norm, newLocalUrl);

          deleteCalendarMetadataFromLocalStorage(cal.url);
          urlsToDeleteFromDB.push(cal.url);

          acc.push({
            ...cal,
            url: newLocalUrl,
            createdFromApp: false,
            isLocal: true,
            type: 'local' as const,
            color: cal.color,
          });
          restoredCalendars.push(cal.displayName || cal.url);
        }
      } else {
        // iCloud→Riff 캘린더가 서버에서 삭제됨 → 이벤트도 정리
        deletedCalendars.push(cal.displayName || cal.url);
        deleteEventsByCalendarUrl(cal.url).catch(err =>
          console.error('[useCalendarMetadata] 외부 삭제된 CalDAV 캘린더 이벤트 정리 실패:', err)
        );
      }

      return acc;
    }, [] as CalendarMetadata[]);

    // 배치 삭제 (루프 내 개별 삭제 대신 한 번의 IN 쿼리)
    if (urlsToDeleteFromDB.length > 0) {
      batchDeleteCalendarMetadataFromDB(urlsToDeleteFromDB).catch(console.error);
    }

    // 항상 상태와 DB를 업데이트 (새로 추가된 CalDAV 캘린더도 반영되도록)
    persistAll(updatedList);
    setCalendarMetadata(updatedList);

    return { urlRemap, deletedCalendars, restoredCalendars };
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

  const convertLocalToGoogle = useCallback((oldUrl: string, newCalendar: CalendarMetadata) => {
    setCalendarMetadata(prev => {
      const filtered = prev.filter(c => c.url !== oldUrl);
      const next: CalendarMetadata[] = [...filtered, { ...newCalendar, isLocal: false, type: 'google' as const, createdFromApp: true }];
      persistAll(next);
      // Google 외부삭제/동기화해제 시 기존 local URL도 함께 relink할 수 있도록 이력 저장
      const googleUrl = normalizeCalendarUrl(newCalendar.url) || newCalendar.url;
      if (googleUrl.startsWith('google:')) {
        const map = readGoogleOriginalLocalUrlMap();
        map[googleUrl] = oldUrl;
        writeGoogleOriginalLocalUrlMap(map);
      }
      deleteCalendarMetadataFromDB(oldUrl).catch(console.error);
      return next;
    });
  }, [persistAll]);

  const getOriginalLocalUrlForGoogle = useCallback((googleUrl: string): string | undefined => {
    const normalized = normalizeCalendarUrl(googleUrl) || googleUrl;
    const map = readGoogleOriginalLocalUrlMap();
    return map[normalized] || map[googleUrl];
  }, []);

  const convertGoogleToLocal = useCallback((oldUrl: string): string => {
    const newLocalUrl = `local-unsynced-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    // 안전장치가 실행되기 전에 동기적으로 localStorage에서 먼저 삭제
    // (saveCalendarMetadata의 createdFromApp 보존 로직이 즉시 복원하는 것을 방지)
    deleteCalendarMetadataFromLocalStorage(oldUrl);
    setCalendarMetadata(prev => {
      const target = prev.find(c => c.url === oldUrl);
      if (!target) return prev;
      const converted: CalendarMetadata = {
        ...target,
        url: newLocalUrl,
        isLocal: true,
        type: 'local' as const,
        createdFromApp: false,
        googleCalendarId: undefined,
        caldavSyncUrl: undefined,
      };
      const next: CalendarMetadata[] = prev.map(c => c.url === oldUrl ? converted : c);
      persistAll(next);
      deleteCalendarMetadataFromDB(oldUrl).catch(console.error);
      return next;
    });
    setVisibleCalendarUrlSet(prev => {
      const next = new Set(prev);
      next.delete(oldUrl);
      next.add(newLocalUrl);
      return next;
    });
    // 원래 local URL 이력은 유지한다.
    // 이유: 외부 삭제/unsync 이후에도 일괄 복구(relink)가 재시도될 수 있어야 함.
    // (map 정리는 별도 관리 시점에서 수행)
    return newLocalUrl;
  }, [persistAll]);

  const convertCalDAVToLocal = useCallback((oldUrl: string): string => {
    const newLocalUrl = `local-unsynced-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    // 안전장치가 실행되기 전에 동기적으로 localStorage에서 먼저 삭제
    // (saveCalendarMetadata의 createdFromApp 보존 로직이 즉시 복원하는 것을 방지)
    deleteCalendarMetadataFromLocalStorage(oldUrl);
    setCalendarMetadata(prev => {
      const target = prev.find(c => c.url === oldUrl);
      if (!target) return prev;
      const converted: CalendarMetadata = {
        ...target,
        url: newLocalUrl,
        isLocal: true,
        type: 'local' as const,
        createdFromApp: false,
        originalCalDAVUrl: undefined,
        googleCalendarId: undefined,
        caldavSyncUrl: undefined,
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
    // persistAll 이전에 동기적으로 localStorage에서 먼저 삭제
    // (saveCalendarMetadata의 createdFromApp 보존 안전장치가 복원하는 것을 방지)
    // 방지하지 않으면 refreshMetadata()가 localStorage를 읽어 React state에 재삽입 → DB 재저장 사이클 발생
    deleteCalendarMetadataFromLocalStorage(url);
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
    convertLocalToGoogle,
    convertCalDAVToLocal,
    convertGoogleToLocal,
    getOriginalLocalUrlForGoogle,
    deleteCalendar,
    refreshMetadata,
    refreshMetadataWithServerList,
  };
};
