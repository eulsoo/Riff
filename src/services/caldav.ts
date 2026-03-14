 import { Event } from '../types';
import { serializeEventToICS } from './icsParser';

// ----------------------------------------------------------------------------
// Write Operations (Create, Update, Delete)
// ----------------------------------------------------------------------------

export async function createCalDavEvent(
  config: CalDAVConfig,
  calendarUrl: string,
  event: Partial<Event>
): Promise<{ success: boolean; etag?: string }> {

  // Re-generate UID if missing to be sure
  const uid = event.caldavUid || `vividly-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const eventWithUid = { ...event, caldavUid: uid };
  const finalIcs = serializeEventToICS(eventWithUid);

  return await invokeCalDavProxy<{ success: boolean; etag?: string }>({
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    action: 'createEvent',
    calendarUrl,
    eventUid: uid,
    eventData: finalIcs,
    settingId: config.settingId  // Add settingId
  });
}

export async function updateCalDavEvent(
  config: CalDAVConfig,
  calendarUrl: string,
  uid: string,
  event: Partial<Event>,
  etag?: string
): Promise<{ success: boolean; etag?: string }> {
  const eventWithUid = { ...event, caldavUid: uid };
  const finalIcs = serializeEventToICS(eventWithUid);

  return await invokeCalDavProxy<{ success: boolean; etag?: string }>({
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    action: 'updateEvent',
    calendarUrl,
    eventUid: uid,
    eventData: finalIcs,
    etag, // Send ETag for optimistic concurrency control (if supported)
    settingId: config.settingId
  });
}


export async function deleteCalDavEvent(
  config: CalDAVConfig,
  calendarUrl: string,
  uid: string,
  etag?: string
): Promise<{ success: boolean }> {
  return await invokeCalDavProxy<{ success: boolean }>({
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    action: 'deleteEvent',
    calendarUrl,
    eventUid: uid,
    etag,
    settingId: config.settingId
  });
}

// 원격 CalDAV 서버에 새 캘린더 생성
export async function createRemoteCalendar(
  config: CalDAVConfig,
  calendarName: string,
  calendarColor: string
): Promise<{ success: boolean; calendarUrl: string; displayName: string; color: string }> {
  return await invokeCalDavProxy<{ success: boolean; calendarUrl: string; displayName: string; color: string }>({
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    action: 'createCalendar',
    calendarName,
    calendarColor,
    settingId: config.settingId
  });
}

// 원격 CalDAV 캘린더 삭제
export async function deleteRemoteCalendar(
  config: CalDAVConfig,
  calendarUrl: string
): Promise<{ success: boolean }> {
  return await invokeCalDavProxy<{ success: boolean }>({
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    action: 'deleteCalendar',
    calendarUrl,
    settingId: config.settingId
  });
}

// 원격 CalDAV 캘린더 이름 변경 (PROPPATCH)
export async function renameRemoteCalendar(
  config: CalDAVConfig,
  calendarUrl: string,
  newName: string
): Promise<{ success: boolean }> {
  return await invokeCalDavProxy<{ success: boolean }>({
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    action: 'renameCalendar' as any,
    calendarUrl,
    newCalendarName: newName,
    settingId: config.settingId
  });
}

import { eventExists, eventExistsByUID, deleteRemovedEvents, updateEventUID, updateEventByUID, fetchEventByUID, findEventByDetails, upsertEvent } from './api';
import { supabase, supabaseAnonKey } from '../lib/supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

// 캘린더 URL을 일관되게 비교하기 위해 끝의 슬래시를 제거
const normalizeCalendarUrl = (url: string) => url.replace(/\/+$/, '');

// 동시 동기화 방지 플래그
let syncInFlight = false;

/** 백그라운드 sync 완료까지 대기 (모달 sync가 0 반환 시 재시도 전용) */
export async function waitForSyncIdle(maxWaitMs = 60000): Promise<void> {
  const start = Date.now();
  while (syncInFlight && Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 400));
  }
}

export interface Calendar {
  displayName: string;
  url: string;
  ctag?: string;
  color?: string;
  isShared?: boolean;
  isSubscription?: boolean;
  readOnly?: boolean;
}

export interface CalDAVConfig {
  serverUrl: string;
  username: string;
  password?: string;
  settingId?: string; // For secured credential lookup
}

interface SyncCollectionResult {
  events: Omit<Event, 'id'>[];
  syncToken: string | null;
  hasDeletions: boolean;
}

const getSyncTokenStorageKey = (config: CalDAVConfig) =>
  `caldavSyncTokens:${config.serverUrl}:${config.username}`;

const decodeJwtPayload = (token: string): Record<string, any> | null => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

const getFunctionHeaders = async (): Promise<Record<string, string> | null> => {
  try {
    const { data } = await supabase.auth.getSession();
    let token = data?.session?.access_token || null;
    const expiresAt = data?.session?.expires_at ? data.session.expires_at * 1000 : null;

    // 만료/임박이면 refresh 시도
    const needsRefresh = !token || (expiresAt && Date.now() > expiresAt - 60 * 1000);
    if (needsRefresh) {
      const refreshed = await supabase.auth.refreshSession();
      token = refreshed.data?.session?.access_token || null;
    }

    // refresh 실패 또는 만료된 토큰이면 호출하지 않음
    if (!token) {
      console.warn('CalDAV 동기화: 유효한 세션 토큰이 없어 요청을 건너뜁니다.');
      return null;
    }

    const payload = decodeJwtPayload(token);
    const tokenExp = payload?.exp ? payload.exp * 1000 : null;
    if (tokenExp && Date.now() > tokenExp - 30 * 1000) {
      console.warn('CalDAV 동기화: 만료된 세션 토큰입니다.');
      return null;
    }

    if (payload?.iss && supabaseUrl && !payload.iss.startsWith(`${supabaseUrl}/auth/v1`)) {
      console.error('CalDAV 동기화: Supabase 프로젝트가 일치하지 않습니다.', {
        expected: `${supabaseUrl}/auth/v1`,
        actual: payload.iss,
      });
      return null;
    }

    return {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey || '',
    };
  } catch (error) {
    console.error('세션 토큰 가져오기/갱신 실패:', error);
  }
  console.warn('CalDAV 동기화: 세션 토큰이 없어 요청을 건너뜁니다.');
  return null;
};

const invokeCalDavProxy = async <T>(
  body: Record<string, any>,
  retryOnUnauthorized: boolean = true
): Promise<T> => {
  // Check for offline status first to avoid unnecessary network errors
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    // Return a rejected promise with a specific error/code so caller can ignore it
    const error = new Error('Network is offline');
    (error as any).code = 'OFFLINE'; 
    throw error;
  }

  if (!supabaseUrl) {
    throw new Error('Supabase URL이 설정되지 않아 CalDAV 요청을 실행할 수 없습니다.');
  }

  let headers = await getFunctionHeaders();
  if (!headers) {
    throw new Error('인증 토큰이 없어 CalDAV 요청을 실행할 수 없습니다.');
  }

  const doFetch = async () => {
    // 이미 백엔드 프록시에서 requestData.password가 있으면 우선 사용하도록 되어 있음
    // 클라이언트에서 강제로 지우면, 유저가 새로 입력한 암호가 전달되지 않는 문제가 발생하므로 삭제 로직 제거
    const payload = { ...body };
    const response = await fetch(`${supabaseUrl}/functions/v1/caldav-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: headers!.Authorization,
        apikey: headers!.apikey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('CalDAV proxy error', {
        status: response.status,
        body: errorText,
      });
      // 에러 메시지에 상세 내용을 포함시킵니다. (JSON 파싱 시도)
      let detailedMessage = errorText;
      try {
        const jsonError = JSON.parse(errorText);
        if (jsonError.error) detailedMessage = jsonError.error;
      } catch (e) {
        // ignore
      }
      
      let errorMessage = detailedMessage.substring(0, 300);
      
      // 사용자에게 노출할 에러는 백엔드 수식어를 붙이지 않음
      if (detailedMessage.includes('애플 계정 인증에 실패')) {
         errorMessage = detailedMessage;
      } else {
         errorMessage = `서버 통신 오류 (${response.status}): ${errorMessage}`;
      }

      const error = new Error(errorMessage);
      (error as any).status = response.status;
      (error as any).body = errorText;
      throw error;
    }

    return (await response.json()) as T;
  };

  try {
    return await doFetch();
  } catch (error: any) {
    if (retryOnUnauthorized && error?.status === 401) {
      await supabase.auth.refreshSession();
      headers = await getFunctionHeaders();
      if (headers) {
        return await doFetch();
      }
    }
    throw error;
  }
};

const readSyncTokens = (config: CalDAVConfig): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(getSyncTokenStorageKey(config));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeSyncTokens = (config: CalDAVConfig, tokens: Record<string, string>) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getSyncTokenStorageKey(config), JSON.stringify(tokens));
};

/** 동기화 해제 시 해당 캘린더의 sync token 제거 → 재동기화 시 전체 fetch 보장 */
export const clearCalDAVSyncTokenForCalendar = (
  config: CalDAVConfig,
  calendarUrl: string
): void => {
  if (typeof window === 'undefined') return;
  try {
    const tokens = readSyncTokens(config);
    const norm = normalizeCalendarUrl(calendarUrl);
    if (norm && tokens[norm]) {
      delete tokens[norm];
      writeSyncTokens(config, tokens);
    }
    if (calendarUrl !== norm && tokens[calendarUrl]) {
      delete tokens[calendarUrl];
      writeSyncTokens(config, tokens);
    }
  } catch (e) {
    console.warn('clearCalDAVSyncTokenForCalendar failed:', e);
  }
};

// 사용 가능한 캘린더 목록 가져오기 (Edge Function 사용)
export async function getCalendars(config: CalDAVConfig): Promise<Calendar[]> {
  try {
    const response = await invokeCalDavProxy<Calendar[]>({
      serverUrl: config.serverUrl,
      username: config.username,
      password: config.password,
      settingId: config.settingId,
      action: 'listCalendars',
    });

    const data = response;

    if (!data || !Array.isArray(data)) {
      if (data && typeof data === 'object' && 'error' in data) {
        throw new Error((data as any).error || '캘린더 목록을 가져올 수 없습니다.');
      }
      throw new Error('캘린더 목록을 가져올 수 없습니다.');
    }

    if (data.length === 0) {
      throw new Error('캘린더를 찾을 수 없습니다. iCloud에서 캘린더가 활성화되어 있는지 확인해주세요.');
    }

    return data as Calendar[];
  } catch (error: any) {
    console.error('캘린더 목록 가져오기 실패:', error);
    let errorMessage = error.message || '캘린더 목록을 가져올 수 없습니다.';
    throw new Error(errorMessage);
  }
}

// 특정 캘린더의 이벤트 가져오기 (Edge Function 사용)
export async function fetchCalendarEvents(
  config: CalDAVConfig,
  calendarUrl: string,
  startDate?: Date,
  endDate?: Date
): Promise<Omit<Event, 'id'>[]> {
  try {
    const startDateStr = startDate ? startDate.toISOString().split('T')[0] : undefined;
    const endDateStr = endDate ? endDate.toISOString().split('T')[0] : undefined;
    const userTimezone = localStorage.getItem('appTimezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const data = await invokeCalDavProxy<Omit<Event, 'id'>[]>({
      serverUrl: config.serverUrl,
      username: config.username,
      password: config.password,
      settingId: config.settingId,
      action: 'fetchEvents',
      calendarUrl,
      startDate: startDateStr,
      endDate: endDateStr,
      userTimezone,
    });

    if (!data || !Array.isArray(data)) {
       return [];
    }

    return data as Omit<Event, 'id'>[];
  } catch (error: any) {
    console.error('이벤트 가져오기 실패:', error);
    throw error;
  }
}

export async function fetchSyncToken(
  config: CalDAVConfig,
  calendarUrl: string
): Promise<string | null> {
  try {
    const data = await invokeCalDavProxy<{ syncToken: string | null }>({
      serverUrl: config.serverUrl,
      username: config.username,
      password: config.password,
      settingId: config.settingId,
      action: 'getSyncToken',
      calendarUrl,
    });

    return data?.syncToken || null;
  } catch (error: any) {
    console.error('sync-token 가져오기 실패:', error);
    return null;
  }
}

export async function fetchSyncCollection(
  config: CalDAVConfig,
  calendarUrl: string,
  syncToken: string
): Promise<SyncCollectionResult> {
  const userTimezone = localStorage.getItem('appTimezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const data = await invokeCalDavProxy<{
    events?: Omit<Event, 'id'>[];
    syncToken?: string | null;
    hasDeletions?: boolean;
  }>({
    serverUrl: config.serverUrl,
    username: config.username,
    password: config.password,
    settingId: config.settingId,
    action: 'syncCollection',
    calendarUrl,
    syncToken,
    userTimezone,
  });

  return {
    events: data?.events || [],
    syncToken: data?.syncToken || null,
    hasDeletions: Boolean(data?.hasDeletions),
  };
}

interface FetchResult {
  calendarUrl: string;
  eventsToProcess: Omit<Event, 'id'>[];
  fullStartDate?: Date;
  fullEndDate?: Date;
  usedFullFetch: boolean;
  syncToken: string | null;
}

const logSyncScope = (
  forceFullSync: boolean,
  lastSyncAt?: string | null,
  manualRange?: { startDate: Date; endDate: Date }
) => {
  if (forceFullSync) {
    console.log('MANUAL SYNC: Forcing full sync (ignoring sync tokens).');
  }

  if (lastSyncAt) {
    console.log(`마지막 동기화 시점(${lastSyncAt})부터 동기화합니다.`);
    return;
  }

  if (manualRange) {
    console.log(
      `구간 동기화: ${manualRange.startDate.toISOString().split('T')[0]} ~ ${manualRange.endDate.toISOString().split('T')[0]}`
    );
    return;
  }

  console.log('첫 동기화: 최근 1년간의 일정을 가져옵니다.');
};

const buildUrlsToSync = (
  selectedCalendarUrls: string[],
  excludeCalendarUrls?: Set<string>
): string[] => {
  const excludeSet = excludeCalendarUrls ?? new Set<string>();
  return selectedCalendarUrls.filter(raw => {
    const normalized = normalizeCalendarUrl(raw);
    return !excludeSet.has(normalized) && !excludeSet.has(raw);
  });
};

const isAuthSyncError = (error: any): boolean =>
  error?.message?.includes('401') ||
  error?.message?.includes('Unauthorized') ||
  error?.status === 401 ||
  (error?.body && error.body.includes('401'));

interface CalendarSyncWorkUnit extends FetchResult {
  syncResult: SyncCollectionResult | null;
}

interface ProcessEventsResult {
  syncedCount: number;
  skippedCount: number;
  currentEventUids: Set<string>;
}

export interface SyncSelectedCalendarsOptions {
  lastSyncAt?: string | null;
  forceFullSync?: boolean;
  manualRange?: { startDate: Date; endDate: Date };
  excludeCalendarUrls?: Set<string>;
  onProgress?: (current: number, total: number) => void;
}

const getDefaultFullFetchRange = (): { startDate: Date; endDate: Date } => {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 1);
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + 3);
  return { startDate, endDate };
};

const collectEventUpdates = (existing: any, event: any) => {
  const normalizeTime = (value?: string | null) => value ?? null;
  const updates: {
    title?: string;
    date?: string;
    memo?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    endDate?: string | null;
    color?: string;
    etag?: string | null;
  } = {};

  if (existing.title !== event.title) updates.title = event.title;
  if (existing.date !== event.date) updates.date = event.date;
  if ((existing.memo ?? null) !== (event.memo ?? null)) updates.memo = event.memo ?? null;
  if (normalizeTime(existing.startTime) !== normalizeTime(event.startTime)) {
    updates.startTime = event.startTime ?? null;
  }
  if (normalizeTime(existing.endTime) !== normalizeTime(event.endTime)) {
    updates.endTime = event.endTime ?? null;
  }

  const existingEndDate = (existing as any).endDate ?? null;
  const newEndDate = (event as any).endDate ?? null;
  if (existingEndDate !== newEndDate) {
    updates.endDate = newEndDate;
  }
  if (existing.color !== event.color) updates.color = event.color;
  if ((existing.etag ?? null) !== (event.etag ?? null)) updates.etag = event.etag ?? null;

  return updates;
};

const resolveCalendarWorkUnit = async (
  config: CalDAVConfig,
  calendarUrl: string,
  forceFullSync: boolean,
  manualRange?: { startDate: Date; endDate: Date },
  syncTokenFromStore?: string
): Promise<CalendarSyncWorkUnit> => {
  let syncResult: SyncCollectionResult | null = null;
  if (!forceFullSync && syncTokenFromStore && !manualRange) {
    try {
      syncResult = await fetchSyncCollection(config, calendarUrl, syncTokenFromStore);
    } catch (error: any) {
      if (error?.code !== 'OFFLINE') {
        console.warn(`sync-collection 실패, 전체 동기화로 전환: ${calendarUrl}`, error);
      }
      syncResult = null;
    }
  }

  if (syncResult?.hasDeletions) syncResult = null;

  if (syncResult) {
    return {
      calendarUrl,
      eventsToProcess: syncResult.events,
      usedFullFetch: false,
      syncToken: syncResult.syncToken,
      syncResult,
    };
  }

  const range = manualRange ?? getDefaultFullFetchRange();
  const eventsToProcess = await fetchCalendarEvents(config, calendarUrl, range.startDate, range.endDate);
  return {
    calendarUrl,
    eventsToProcess,
    fullStartDate: range.startDate,
    fullEndDate: range.endDate,
    usedFullFetch: true,
    syncToken: null,
    syncResult: null,
  };
};

const processCalendarEvents = async (
  calendarUrl: string,
  eventsToProcess: Omit<Event, 'id'>[]
): Promise<ProcessEventsResult> => {
  const currentEventUids = new Set<string>();
  let syncedCount = 0;
  let skippedCount = 0;

  for (const event of eventsToProcess) {
    const eventWithUID = event as any;
    const uid = eventWithUID.uid;

    if (uid) {
      currentEventUids.add(uid);
      const exists = await eventExistsByUID(uid, calendarUrl);
      if (exists) {
        const existing = await fetchEventByUID(uid, calendarUrl);
        if (existing) {
          const updates = collectEventUpdates(existing, event);
          const hasUpdates = Object.keys(updates).length > 0;
          if (hasUpdates) {
            const updated = await updateEventByUID(uid, calendarUrl, updates);
            if (updated) syncedCount++;
            else skippedCount++;
          } else {
            skippedCount++;
          }
        } else {
          skippedCount++;
        }
        continue;
      }

      const existingEventId = await findEventByDetails(event, calendarUrl);
      if (existingEventId) {
        await updateEventUID(existingEventId, uid, calendarUrl);
        skippedCount++;
        continue;
      }

      const { uid: _uid, ...eventWithoutUid } = event as any;
      const result = await upsertEvent({
        ...eventWithoutUid,
        caldavUid: uid,
        calendarUrl,
        source: 'caldav',
      });
      if (result) syncedCount++;
      continue;
    }

    const exists = await eventExists(event, calendarUrl, 'caldav');
    if (!exists) {
      const result = await upsertEvent({
        ...event,
        calendarUrl,
        source: 'caldav',
      });
      if (result) syncedCount++;
    } else {
      skippedCount++;
    }
  }

  return { syncedCount, skippedCount, currentEventUids };
};

// 선택한 여러 캘린더의 이벤트 동기화
export async function syncSelectedCalendars(
  config: CalDAVConfig,
  selectedCalendarUrls: string[],
  options: SyncSelectedCalendarsOptions = {}
): Promise<number> {
  const {
    lastSyncAt,
    forceFullSync = false,
    manualRange,
    excludeCalendarUrls,
    onProgress
  } = options;

  // 동기화 중복 실행 방지
  if (syncInFlight) {
    return 0;
  }

  // 세션 검사: 로그아웃 상태이면 즉시 중단 (로그아웃 후 비동기 sync가 계속 실행되는 것 방지)
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.user) {
    return 0;
  }

  syncInFlight = true;

  try {
    let syncedCount = 0;
    let skippedCount = 0;
    let deletedCount = 0;
    const syncTokens = readSyncTokens(config);
    logSyncScope(forceFullSync, lastSyncAt, manualRange);
    const urlsToSync = buildUrlsToSync(selectedCalendarUrls, excludeCalendarUrls);

    // manualRange(모달 동기화) 시 캘린더 fetch 병렬화 → 2분→30초 수준으로 단축
    const useParallelFetch = Boolean(manualRange);
    let fetchResults: FetchResult[] = [];

    if (useParallelFetch) {
      const fullStart = manualRange!.startDate;
      const fullEnd = manualRange!.endDate;
      const results = await Promise.all(
        urlsToSync.map(async (rawUrl, idx) => {
          const calendarUrl = normalizeCalendarUrl(rawUrl);
          const events = await fetchCalendarEvents(config, calendarUrl, fullStart, fullEnd);
          onProgress?.(idx + 1, urlsToSync.length * 2); // 각 캘린더 fetch 완료 시 진행 표시 (total: fetch+process)
          return {
            calendarUrl,
            eventsToProcess: events,
            fullStartDate: fullStart,
            fullEndDate: fullEnd,
            usedFullFetch: true,
            syncToken: null as string | null,
          } satisfies FetchResult;
        })
      );
      fetchResults = results;
    }

    for (let i = 0; i < urlsToSync.length; i++) {
      const rawCalendarUrl = urlsToSync[i];
      const calendarUrl = normalizeCalendarUrl(rawCalendarUrl);
      try {
        const workUnit: CalendarSyncWorkUnit =
          useParallelFetch && fetchResults[i]
            ? { ...fetchResults[i], syncResult: null }
            : await resolveCalendarWorkUnit(
                config,
                calendarUrl,
                forceFullSync,
                manualRange,
                syncTokens[calendarUrl]
              );

        const processed = await processCalendarEvents(calendarUrl, workUnit.eventsToProcess);
        onProgress?.(urlsToSync.length + i + 1, urlsToSync.length * 2); // 처리 단계 진행 표시
        const calendarSyncedCount = processed.syncedCount;
        const calendarSkippedCount = processed.skippedCount;
        
        syncedCount += calendarSyncedCount;
        skippedCount += calendarSkippedCount;
        
        if (calendarSyncedCount > 0 || calendarSkippedCount > 0) {
          console.log(`캘린더 ${calendarUrl}: ${calendarSyncedCount}개 추가, ${calendarSkippedCount}개 스킵`);
        }
        
        // 해당 캘린더에서 삭제된 이벤트 찾기 및 삭제
        // allEvents가 빈 배열이어도 삭제 체크 수행 (캘린더에서 모든 이벤트를 삭제한 경우 처리)
        if (workUnit.usedFullFetch && workUnit.fullStartDate && workUnit.fullEndDate) {
          // 삭제 체크는 실제 동기화 범위(fullStartDate/fullEndDate)와 동일하게 사용
          const deleted = await deleteRemovedEvents(
            calendarUrl,
            processed.currentEventUids,
            workUnit.eventsToProcess,
            workUnit.fullStartDate,
            workUnit.fullEndDate
          );
          deletedCount += deleted;
          if (deleted > 0) {
            console.log(
              `캘린더 ${calendarUrl}: ${deleted}개 삭제 (범위: ${workUnit.fullStartDate.toISOString().slice(0, 10)} ~ ${workUnit.fullEndDate.toISOString().slice(0, 10)})`
            );
          } else if (workUnit.eventsToProcess.length === 0) {
            console.log(`캘린더 ${calendarUrl}: 이벤트 없음 (삭제 체크 완료)`);
          }
        }

        if (workUnit.syncResult?.syncToken) {
          syncTokens[calendarUrl] = workUnit.syncResult.syncToken;
        } else if (workUnit.usedFullFetch) {
          const nextToken = await fetchSyncToken(config, calendarUrl);
          if (nextToken) {
            syncTokens[calendarUrl] = nextToken;
          }
        }
        
        // Save tokens immediately after each calendar to prevent progress loss on refresh
        writeSyncTokens(config, syncTokens);

      } catch (error: any) {
        // [Safety] 401 인증 에러(계정 잠김/암호 변경 등) 발생 시,
        // 남은 캘린더들에 대해서도 불필요한 요청을 보내지 않도록 즉시 동기화를 중단합니다.
        // 이를 통해 Edge Function 호출 비용과 트래픽(Egress) 낭비를 방지합니다.
        if (isAuthSyncError(error)) {
           console.error(`[Critical] Auth Error on ${calendarUrl}. Aborting remaining syncs.`);
           throw error; // 루프 종료 및 에러 전파
        }

        if (error?.code === 'OFFLINE' || error?.message === 'Network is offline') {
             // Suppress log when offline
        } else {
             console.error(`캘린더 ${calendarUrl} 동기화 실패:`, error);
        }
      }
    }
    
    // writeSyncTokens(config, syncTokens); // Already saved in loop
    console.log(`동기화 완료: ${syncedCount}개 추가, ${deletedCount}개 삭제, ${skippedCount}개 스킵`);
    
    // 삭제된 이벤트가 있으면 -1을 반환하여 UI 갱신을 트리거
    if (deletedCount > 0) {
      return -1; // 삭제가 있었음을 나타냄
    }
    
    return syncedCount;
  } finally {
    syncInFlight = false;
  }
}
