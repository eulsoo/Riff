
import { supabase, supabaseAnonKey } from '../lib/supabase';
import { DiaryEntry, Event, Routine, Todo } from '../types';

const SUPABASE_FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

// 캘린더 URL 정규화: 끝의 슬래시 제거
export const normalizeCalendarUrl = (url?: string | null) =>
  url ? url.replace(/\/+$/, '') : url;

// 캘린더 메타데이터 저장을 위한 로컬 스토리지 키
const CALENDAR_METADATA_KEY = 'caldavCalendarMetadata';
const LOCAL_CALENDAR_METADATA_KEY = 'localCalendarMetadata';

export interface CalendarMetadata {
  url: string; // 로컬 캘린더의 경우 'local:' 접두사가 붙은 ID
  displayName: string;
  color: string;
  isLocal?: boolean;
  isVisible?: boolean;
  type?: 'local' | 'subscription' | 'caldav' | 'google';
  subscriptionUrl?: string;
  isShared?: boolean;
  isSubscription?: boolean;
  readOnly?: boolean;
  createdFromApp?: boolean; // 앱에서 생성되어 외부로 동기화된 캘린더 식별
  googleCalendarId?: string; // Google Calendar 전용 캘린더 ID
  originalCalDAVUrl?: string; // unsync 시 원래 CalDAV URL 보존 (서버 삭제 여부 확인용)
  caldavSyncUrl?: string; // 이중 동기화: Google-primary cal이 iCloud에도 동기화된 경우 CalDAV URL 저장
}

// CalDAV 메타데이터 저장 (로컬 캘린더 제외)
// createdFromApp 플래그는 기존 데이터에서 유지 (단, 새 데이터에 해당 캘린더가 있을 때만)
// 구독 캘린더는 항상 보존 (CalDAV 동기화 시 구독 캘린더가 삭제되지 않도록)
export const saveCalendarMetadata = (metadata: CalendarMetadata[]) => {
  if (typeof window === 'undefined') return;
  try {
    // 기존 메타데이터에서 createdFromApp 플래그 가져오기
    const existingRaw = window.localStorage.getItem(CALENDAR_METADATA_KEY);
    const existingMap: Record<string, CalendarMetadata> = existingRaw ? JSON.parse(existingRaw) : {};

    const map = metadata
      .filter(m => !m.isLocal) // 로컬 제외하고 저장
      .reduce((acc, item) => {
        const normalizedUrl = normalizeCalendarUrl(item.url)!;
        // 기존에 createdFromApp: true였던 캘린더는 플래그 유지
        const existingMeta = existingMap[normalizedUrl];
        acc[normalizedUrl] = { 
          ...item, 
          url: normalizedUrl,
          // Riff에서 Google로 보낸 캘린더(google: url)는 createdFromApp 유지
          createdFromApp: item.createdFromApp ?? existingMeta?.createdFromApp ?? (normalizedUrl.startsWith('google:') ? true : undefined)
        };
        return acc;
      }, {} as Record<string, CalendarMetadata>);

    // 안전장치: 기존에 저장된 구독 캘린더 및 createdFromApp 캘린더는 새 데이터에 없어도 항상 보존
    // (CalDAV 동기화 시 구독 캘린더 또는 Riff→Google로 내보낸 캘린더가 실수로 삭제되는 현상 방지)
    for (const [url, cal] of Object.entries(existingMap)) {
      if (
        !map[url] && // 새 데이터에 없을 때만
        (
          cal.type === 'subscription' || cal.isSubscription === true || (cal.url.startsWith('http') && cal.url.endsWith('.ics')) ||
          cal.createdFromApp === true // Riff에서 외부로 내보낸 캘린더 (Google 등)
        )
      ) {
        map[url] = cal;
      }
    }

    window.localStorage.setItem(CALENDAR_METADATA_KEY, JSON.stringify(map));
  } catch (error) {
    console.error('Error saving calendar metadata:', error);
  }
};


export const saveLocalCalendarMetadata = (metadata: CalendarMetadata[]) => {
  if (typeof window === 'undefined') return;
  try {
    // 로컬 캘린더만 필터링해서 저장
    const localOnly = metadata.filter(m => m.isLocal);
    window.localStorage.setItem(LOCAL_CALENDAR_METADATA_KEY, JSON.stringify(localOnly));
  } catch (error) {
    console.error('Error saving local calendar metadata:', error);
  }
};

export const getCalendarMetadata = (): Record<string, CalendarMetadata> => {
  if (typeof window === 'undefined') return {};
  try {
    // CalDAV 캘린더
    const rawCalDAV = window.localStorage.getItem(CALENDAR_METADATA_KEY);
    const caldavMap = rawCalDAV ? JSON.parse(rawCalDAV) : {};

    // 로컬 캘린더
    const rawLocal = window.localStorage.getItem(LOCAL_CALENDAR_METADATA_KEY);
    const localList: CalendarMetadata[] = rawLocal ? JSON.parse(rawLocal) : [];
    
    // 로컬 캘린더를 맵에 병합
    localList.forEach(cal => {
      caldavMap[cal.url] = { ...cal, isLocal: true };
    });

    return caldavMap;
  } catch {
    return {};
  }
};


// 아바타 업로드
export const uploadAvatar = async (file: File, userId: string): Promise<string | null> => {
  const ext = file.name.split('.').pop() || 'png';
  const path = `avatars/${userId}/avatar-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true });

  if (uploadError) {
    console.error('Error uploading avatar:', uploadError);
    return null;
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data?.publicUrl || null;
};

export const saveUserAvatar = async (avatarUrl: string | null): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from('user_avatars')
    .upsert({ user_id: user.id, avatar_url: avatarUrl, updated_at: new Date().toISOString() });

  if (error) {
    console.error('Error saving avatar url:', error);
    return false;
  }
  return true;
};

export const getUserAvatar = async (): Promise<string | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('user_avatars')
    .select('avatar_url')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('Error fetching avatar url:', error);
    }
    return null;
  }
  return data?.avatar_url || null;
};

// Google Refresh Token — Edge Function을 통해 서버에서 암호화 후 저장
// supabase.functions.invoke 대신 fetch 직접 사용 —
// SDK가 자신의 세션 헤더로 Authorization을 덮어쓰는 문제 완전 회피
export const saveGoogleRefreshToken = async (refreshToken: string, accessToken?: string): Promise<boolean> => {
  // 직접 전달된 토큰 우선, 없으면 현재 세션에서 획득
  let token = accessToken;
  if (!token) {
    const { data: { session } } = await supabase.auth.getSession();
    token = session?.access_token;
  }

  if (!token) {
    console.warn('[saveGoogleRefreshToken] 유효한 액세스 토큰 없음, 저장 건너뜀');
    return false;
  }

  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/refresh-google-token`, {
      method: 'POST',
      keepalive: true, // 팝업 창이 닫혀도 요청이 완료될 수 있도록 유지
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ action: 'save', refreshToken }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('Error saving Google refresh token:', resp.status, errText);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error saving Google refresh token:', e);
    return false;
  }
};

// ─────────────────────────────────────────────────────────────
// Calendar Metadata DB (Cross-device persistence)
// ─────────────────────────────────────────────────────────────

// DB row → CalendarMetadata 변환
const dbRowToCalendarMetadata = (row: any): CalendarMetadata => ({
  url: row.url,
  displayName: row.display_name ?? '',
  color: row.color ?? '#3b82f6',
  type: row.type ?? undefined,
  isLocal: row.is_local ?? false,
  isVisible: row.is_visible ?? true,
  isSubscription: row.is_subscription ?? false,
  isShared: row.is_shared ?? false,
  readOnly: row.read_only ?? false,
  createdFromApp: row.created_from_app ?? (row.url?.startsWith?.('google:') ? true : false),
  googleCalendarId: row.google_calendar_id ?? undefined,
  subscriptionUrl: row.subscription_url ?? undefined,
  originalCalDAVUrl: row.original_caldav_url ?? undefined,
  caldavSyncUrl: row.caldav_sync_url ?? undefined,
});

// CalendarMetadata → DB row 변환
const calendarMetadataToDbRow = (meta: CalendarMetadata, userId: string) => ({
  user_id: userId,
  url: normalizeCalendarUrl(meta.url) || meta.url,
  display_name: meta.displayName,
  color: meta.color,
  type: meta.type ?? null,
  is_local: meta.isLocal ?? false,
  is_visible: meta.isVisible ?? true,
  is_subscription: meta.isSubscription ?? false,
  is_shared: meta.isShared ?? false,
  read_only: meta.readOnly ?? false,
  created_from_app: meta.createdFromApp ?? false,
  google_calendar_id: meta.googleCalendarId ?? null,
  subscription_url: meta.subscriptionUrl ?? null,
  original_caldav_url: meta.originalCalDAVUrl ?? null,
  caldav_sync_url: meta.caldavSyncUrl ?? null,
  updated_at: new Date().toISOString(),
});

/**
 * DB에서 현재 사용자의 캘린더 메타데이터를 전부 불러옴
 * localStorage 캐시와 병합해서 최종 목록을 반환
 */
export const fetchCalendarMetadataFromDB = async (): Promise<CalendarMetadata[]> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('calendar_metadata')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching calendar metadata from DB:', error);
    return [];
  }

  return (data ?? []).map(dbRowToCalendarMetadata);
};

/**
 * 캘린더 메타데이터 목록 전체를 DB에 upsert (있으면 업데이트, 없으면 생성)
 * localStorage에도 동시에 저장해서 빠른 초기 로딩 유지
 */
export const saveCalendarMetadataToDB = async (metaList: CalendarMetadata[]): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const rows = metaList.map(m => calendarMetadataToDbRow(m, user.id));
  if (rows.length === 0) return true;

  const { error } = await supabase
    .from('calendar_metadata')
    .upsert(rows, { onConflict: 'user_id,url' });

  if (error) {
    console.error('Error saving calendar metadata to DB:', error);
    return false;
  }
  return true;
};

/**
 * 특정 캘린더를 DB에서 삭제
 */
export const deleteCalendarMetadataFromDB = async (url: string): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const normalizedUrl = normalizeCalendarUrl(url) || url;
  const { error } = await supabase
    .from('calendar_metadata')
    .delete()
    .eq('user_id', user.id)
    .eq('url', normalizedUrl);

  if (error) {
    console.error('Error deleting calendar metadata from DB:', error);
    return false;
  }
  return true;
};

/**
 * 여러 캘린더를 DB에서 한 번의 쿼리로 일괄 삭제 (N+1 방지)
 */
export const batchDeleteCalendarMetadataFromDB = async (urls: string[]): Promise<boolean> => {
  if (urls.length === 0) return true;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const normalizedUrls = urls.map(u => normalizeCalendarUrl(u) || u);
  const { error } = await supabase
    .from('calendar_metadata')
    .delete()
    .eq('user_id', user.id)
    .in('url', normalizedUrls);

  if (error) {
    console.error('Error batch deleting calendar metadata from DB:', error);
    return false;
  }
  return true;
};

/**
 * 특정 CalDAV URL을 localStorage(caldavCalendarMetadata)에서 즉시 삭제.
 * saveCalendarMetadata 안전장치(createdFromApp 보존 로직)가 stale CalDAV URL을
 * 재복원하는 것을 방지하기 위해, DB 삭제와 함께 반드시 호출해야 함.
 */
export const deleteCalendarMetadataFromLocalStorage = (url: string) => {
  if (typeof window === 'undefined') return;
  const normalized = normalizeCalendarUrl(url) || url;

  // caldavCalendarMetadata에서 삭제
  const rawCalDAV = window.localStorage.getItem(CALENDAR_METADATA_KEY);
  if (rawCalDAV) {
    try {
      const map: Record<string, CalendarMetadata> = JSON.parse(rawCalDAV);
      if (map[normalized] || map[url]) {
        delete map[normalized];
        delete map[url];
        window.localStorage.setItem(CALENDAR_METADATA_KEY, JSON.stringify(map));
      }
    } catch { /* ignore */ }
  }

  // localCalendarMetadata에서도 혹시 있으면 삭제
  const rawLocal = window.localStorage.getItem(LOCAL_CALENDAR_METADATA_KEY);
  if (rawLocal) {
    try {
      const list: CalendarMetadata[] = JSON.parse(rawLocal);
      const filtered = list.filter(c => c.url !== url && c.url !== normalized);
      if (filtered.length !== list.length) {
        window.localStorage.setItem(LOCAL_CALENDAR_METADATA_KEY, JSON.stringify(filtered));
      }
    } catch { /* ignore */ }
  }
};

import { META_ID, serializeMemo, parseMemo } from './memoUtils';

// Events
export const fetchEvents = async (startDate?: string, endDate?: string) => {
  let query = supabase
    .from('events')
    .select('*')
    .order('date', { ascending: true });

  if (startDate) {
    query = query.gte('date', startDate);
  }
  if (endDate) {
    query = query.lte('date', endDate);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching events:', error);
    return [];
  }
  return (data || []).map((event: any) => {
    const { memo, meta } = parseMemo(event.memo);
    return {
      ...event,
      memo, // Cleaned memo
      startTime: event.start_time,
      endTime: event.end_time,
      endDate: event.end_date || meta.endDate, // Prefer DB col, fallback to meta
      calendarUrl: normalizeCalendarUrl(event.calendar_url),
      caldavUid: event.caldav_uid,
    };
  });
};

export const createEvent = async (event: Omit<Event, 'id'> & { uid?: string; caldavUid?: string; calendarUrl?: string; source?: string }) => {
  // uid, caldavUid, calendarUrl, source는 제외하고 나머지만 사용
  const { startTime, endTime, endDate, uid, caldavUid, calendarUrl, source, ...rest } = event;
  
  // rest에서 불필요한 필드 제거 (uid, caldavUid가 포함되어 있을 수 있음)
  const cleanRest: any = { ...rest };
  delete cleanRest.uid;
  delete cleanRest.caldavUid;
  
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl || undefined);

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    console.error('Cannot create event without authenticated user session');
    return null;
  }

  const payload: any = {
    ...cleanRest,
    start_time: startTime,
    end_time: endTime,
    // end_date: endDate, // REMOVED: DB column likely missing
    memo: serializeMemo(rest.memo, { endDate }), // Store in Meta only
    source: source || 'manual',
    user_id: userData.user.id,
  };
  
  // uid 또는 caldavUid 중 하나를 사용
  const eventUid = uid || caldavUid;
  if (eventUid) {
    payload.caldav_uid = eventUid;
  }
  if (normalizedCalendarUrl) {
    payload.calendar_url = normalizedCalendarUrl;
  }
  if (event.etag) {
    payload.etag = event.etag;
  }
  // Allow restoring specific ID (e.g. for Undo Delete)
  if ((event as any).id) {
    payload.id = (event as any).id;
  }

  const { data, error } = await supabase
    .from('events')
    .insert([payload])
    .select()
    .single();

  if (error) {
    console.error('Error creating event:', error);
    return null;
  }
  const { memo: parsedMemo, meta } = parseMemo(data.memo);
  return {
    ...data,
    memo: parsedMemo, // Return clean memo
    startTime: data.start_time,
    endTime: data.end_time,
    endDate: meta.endDate || data.end_date, // Prefer Meta
    calendarUrl: data.calendar_url,
    caldavUid: data.caldav_uid,
  };
};

// CalDAV 동기화용 Upsert (없으면 생성, 있으면 업데이트)
export const upsertEvent = async (event: Omit<Event, 'id'> & { uid?: string; caldavUid?: string; calendarUrl?: string; source?: string }) => {
  const { startTime, endTime, endDate, uid, caldavUid, calendarUrl, source, ...rest } = event;
  
  const cleanRest: any = { ...rest };
  delete cleanRest.uid;
  delete cleanRest.caldavUid;
  
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl || undefined);

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    // 로그아웃 후 비동기 sync가 계속 실행될 때 발생하는 정상적인 상황
    // console.error 대신 조용히 종료 (콘솔 오염 방지)
    return null;
  }

  const payload: any = {
    ...cleanRest,
    start_time: startTime,
    end_time: endTime,
    // end_date: endDate, // REMOVED: DB column likely missing
    memo: serializeMemo(rest.memo, { endDate }), // Store in Meta
    source: source || 'caldav',
    user_id: userData.user.id,
  };
  
  const eventUid = uid || caldavUid;
  if (eventUid) payload.caldav_uid = eventUid;
  if (normalizedCalendarUrl) payload.calendar_url = normalizedCalendarUrl;
  if (event.etag) payload.etag = event.etag;

  const { data, error } = await supabase
    .from('events')
    .upsert(payload, { onConflict: 'user_id,caldav_uid,calendar_url' })
    .select()
    .single();

  if (error) {
    console.error('Error upserting event:', error);
    return null;
  }
  const { memo: parsedMemo, meta } = parseMemo(data.memo);
  return {
    ...data,
    memo: parsedMemo,
    startTime: data.start_time,
    endTime: data.end_time,
    endDate: meta.endDate || data.end_date,
    calendarUrl: data.calendar_url,
    caldavUid: data.caldav_uid,
  };
};

// UID로 이벤트 존재 확인
export const eventExistsByUID = async (uid: string, calendarUrl: string): Promise<boolean> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);
  const { data, error } = await supabase
    .from('events')
    .select('id')
    .eq('caldav_uid', uid)
    .eq('calendar_url', normalizedCalendarUrl)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error checking event by UID:', error);
    return false;
  }

  return data !== null;
};

// 기존 이벤트에 UID 업데이트
export const updateEventUID = async (
  eventId: string,
  uid: string,
  calendarUrl: string
): Promise<boolean> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);
  const { error } = await supabase
    .from('events')
    .update({ caldav_uid: uid, calendar_url: normalizedCalendarUrl, source: 'caldav' })
    .eq('id', eventId);

  if (error) {
    console.error('Error updating event UID:', error);
    return false;
  }
  return true;
};

// UID로 기존 이벤트 업데이트 (제목/날짜/시간 등 변경 반영)
export const fetchEventByUID = async (
  uid: string,
  calendarUrl: string
): Promise<Event | null> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);
  const { data, error } = await supabase
    .from('events')
    .select('id, title, date, memo, start_time, end_time, color, calendar_url, source, etag')
    .eq('caldav_uid', uid)
    .eq('calendar_url', normalizedCalendarUrl)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching event by UID:', error);
    return null;
  }

  if (!data) return null;

  const { memo: parsedMemo, meta } = parseMemo(data.memo);

  return {
    ...data,
    memo: parsedMemo,
    startTime: data.start_time,
    endTime: data.end_time,
    endDate: meta.endDate, // Restore from meta
    etag: data.etag,
  };
};

export const updateEventByUID = async (
  uid: string,
  calendarUrl: string,
  updates: Partial<{
    title: string;
    date: string;
    memo: string | null;
    startTime: string | null;
    endTime: string | null;
    endDate?: string | null;
    etag?: string | null;
  }>
): Promise<boolean> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);
  const payload: any = {};
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.date !== undefined) payload.date = updates.date;
  if (updates.memo !== undefined) payload.memo = updates.memo;
  if (updates.startTime !== undefined) payload.start_time = updates.startTime;
  if (updates.endTime !== undefined) payload.end_time = updates.endTime;
  if (updates.etag !== undefined) payload.etag = updates.etag;

  // Handle endDate & memo metadata logic
  if (updates.endDate !== undefined) {
    // payload.end_date = updates.endDate; // Removed
    // delete payload.endDate; // Not in payload object initially

    // We must ensure memo is updated with new endDate meta
    let currentMemo = updates.memo;
    
    // If memo is strictly undefined (not null), we might need to fetch existing
    if (currentMemo === undefined) {
      // NOTE: Unlike updateEvent, updateEventByUID is often used during sync where we might have full data or partial.
      // If we don't have memo in updates, we should check DB.
      // However, fetching here adds latency to sync.
      // Let's assume if it's undefined, we fetch.
      const { data: existing } = await supabase
        .from('events')
        .select('memo')
        .eq('caldav_uid', uid)
        .eq('calendar_url', normalizedCalendarUrl)
        .single();
        
      if (existing) {
        const parsed = parseMemo(existing.memo);
        currentMemo = parsed.memo;
      }
    }
    // Note: updates.memo could be null (cleared). verify serializeMemo handles null.
    // serializeMemo expects string | undefined. null -> undefined.
    payload.memo = serializeMemo(currentMemo || undefined, { endDate: updates.endDate });

  } else if (payload.memo !== undefined) {
    // Memo changed, preserve endDate if exists
    const { data: existing } = await supabase
      .from('events')
      .select('memo')
      .eq('caldav_uid', uid)
      .eq('calendar_url', normalizedCalendarUrl)
      .single();
      
    if (existing) {
      const parsed = parseMemo(existing.memo);
      const existingEndDate = parsed.meta.endDate;
      if (existingEndDate) {
        payload.memo = serializeMemo(payload.memo, { endDate: existingEndDate });
      } else {
        payload.memo = serializeMemo(payload.memo, {});
      }
    }
  }

  const { error } = await supabase
    .from('events')
    .update(payload)
    .eq('caldav_uid', uid)
    .eq('calendar_url', normalizedCalendarUrl);

  if (error) {
    console.error('Error updating event by UID:', error);
    return false;
  }
  return true;
};

// 제목, 날짜, 시간으로 이벤트 찾기 (UID가 없는 기존 이벤트용)
export const findEventByDetails = async (
  event: Omit<Event, 'id'>,
  calendarUrl: string
): Promise<string | null> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);
  const { data, error } = await supabase
    .from('events')
    .select('id')
    .eq('title', event.title)
    .eq('date', event.date)
    .eq('start_time', event.startTime || null)
    .eq('end_time', event.endTime || null)
    .eq('calendar_url', normalizedCalendarUrl)
    .eq('source', 'caldav')
    .is('caldav_uid', null) // UID가 없는 이벤트만
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error finding event by details:', error);
    return null;
  }

  return data?.id || null;
};

// 삭제된 이벤트 삭제
export const deleteRemovedEvents = async (
  calendarUrl: string,
  currentUids: Set<string>,
  currentEvents: Array<{ title: string; date: string; startTime?: string; endTime?: string }>,
  startDate?: Date, // 범위 제한을 위한 시작일
  endDate?: Date    // 범위 제한을 위한 종료일
): Promise<number> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);
  const altCalendarUrl = normalizedCalendarUrl ? `${normalizedCalendarUrl}/` : undefined;
  // 현재 이벤트가 없어도 삭제 체크는 수행 (캘린더에서 모든 이벤트를 삭제한 경우를 처리)

  // 안전장치: CalDAV에서 이벤트를 하나도 못 받아온 경우(네트워크 오류/일시적 빈 응답) 삭제를 건너뜀
  if (currentEvents.length === 0 && currentUids.size === 0) {
    console.warn(`삭제 체크 스킵: CalDAV에서 가져온 이벤트가 0개입니다. calendarUrl=${normalizedCalendarUrl}`);
    return 0;
  }

  // 해당 캘린더의 모든 CalDAV 이벤트 가져오기 (기간 제한 적용)
  let query = supabase
    .from('events')
    .select('id, caldav_uid, title, date, start_time, end_time')
    .in('calendar_url', altCalendarUrl ? [normalizedCalendarUrl, altCalendarUrl] : [normalizedCalendarUrl])
    .eq('source', 'caldav');

  // 삭제 검사 범위를 가져온 데이터의 범위로 한정
  if (startDate) {
    const sStr = startDate.toISOString().split('T')[0];
    query = query.gte('date', sStr);
  }
  if (endDate) {
    const eStr = endDate.toISOString().split('T')[0];
    query = query.lte('date', eStr);
  }

  const { data: existingEvents, error: fetchError } = await query;

  if (fetchError || !existingEvents) {
    console.error('Error fetching events for deletion check:', fetchError);
    return 0;
  }

  // 안전장치: 기존 이벤트가 너무 많고(100개 초과) 현재 이벤트가 통째로 비어있으면(0개),
  // 혹시 모를 "네트워크 오류로 인해 가져온게 0개인 상황"을 대비해 삭제를 건너뜀.
  // 단, 기존 이벤트가 소량(<= 100)이면 사용자가 진짜 다 지웠을 수 있으므로 삭제 허용.
  if (existingEvents.length > 100 && currentEvents.length === 0 && currentUids.size === 0) {
    console.warn(`삭제 체크 안전장치: 기존 이벤트가 ${existingEvents.length}개인데 현재 이벤트가 0개여서 삭제를 건너뜁니다. (데이터 손실 방지)`);
    return 0;
  }

  // 현재 CalDAV에 있는 이벤트의 키 생성 (제목+날짜+시간)
  const currentEventKeys = new Set<string>();
  for (const event of currentEvents) {
    const key = `${event.title}|${event.date}|${event.startTime || ''}|${event.endTime || ''}`;
    currentEventKeys.add(key);
  }

  // 삭제할 이벤트 찾기
  const toDelete: string[] = [];
  
  for (const existingEvent of existingEvents) {
    let shouldDelete = false;
    
    if (existingEvent.caldav_uid) {
      // UID가 있는 경우: UID로 비교
      if (!currentUids.has(existingEvent.caldav_uid)) {
        shouldDelete = true;
      }
    } else {
      // UID가 없는 경우: 제목+날짜+시간으로 비교
      const key = `${existingEvent.title}|${existingEvent.date}|${existingEvent.start_time || ''}|${existingEvent.end_time || ''}`;
      if (!currentEventKeys.has(key)) {
        shouldDelete = true;
      }
    }
    
    if (shouldDelete) {
      toDelete.push(existingEvent.id);
    }
  }

  // 안전장치: 대량 삭제 방지 로직 개선
  // 기존: 10개 이상이고 90% 이상 삭제면 차단.
  // 변경: "초기 동기화"나 "캘린더 이동" 같은 상황에서는 대량 삭제가 발생할 수 있음.
  // 따라서, 무조건 막는게 아니라 '경고'만 하고 진행하거나 조건을 완화해야 함.
  // 여기서는 "50개 이상"일 때만 비율 체크를 하고, 정말 위험해 보일 때만 막도록 수정.
  
  if (existingEvents.length >= 50 && toDelete.length > existingEvents.length * 0.95) {
      console.warn(`삭제 체크 경고: 삭제 대상이 매우 많습니다 (${toDelete.length}/${existingEvents.length}). 동기화 무결성을 위해 진행합니다.`);
      // return 0; // 차단하지 않고 진행하도록 변경 (사용자가 웹에서 캘린더를 바꿨거나 대량 정리를 했을 수 있음)
  }
  
  // 안전장치: 기존 이벤트가 5개 이상이고, 삭제할 이벤트가 80% 이상인 경우 경고만 하고 진행
  if (existingEvents.length >= 5 && toDelete.length > existingEvents.length * 0.8) {
    console.warn(`삭제 체크: 삭제 대상이 많습니다 (${toDelete.length}/${existingEvents.length}). 계속 진행합니다.`);
  }

  if (toDelete.length > 0) {
    console.log(`삭제 예정: ${toDelete.length}개 (기존: ${existingEvents.length}개, 현재: ${currentEvents.length}개)`);
    
    // 배치로 나누어 삭제 (한 번에 최대 50개씩 - URL 길이 제한 고려)
    const batchSize = 50;
    let deletedCount = 0;
    
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);
      const { error: deleteError } = await supabase
        .from('events')
        .delete()
        .in('id', batch);

      if (deleteError) {
        console.error(`Error deleting batch ${Math.floor(i / batchSize) + 1}:`, deleteError);
        // 에러가 발생해도 다음 배치 계속 처리
        continue;
      }
      
      deletedCount += batch.length;
    }
    
    if (deletedCount > 0) {
      console.log(`삭제 완료: ${deletedCount}개`);
    }
    
    return deletedCount;
  }

  return 0;
};

export const deleteEvent = async (id: string) => {
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting event:', error);
    return false;
  }
  return true;
};

export const deleteEventByCaldavUid = async (caldavUid: string, calendarUrl: string) => {
  const normalizedUrl = normalizeCalendarUrl(calendarUrl) || calendarUrl;
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('caldav_uid', caldavUid)
    .eq('calendar_url', normalizedUrl);

  if (error) {
    console.error('Error deleting event by caldav_uid:', error);
    return false;
  }
  return true;
};

// Google sync용 bulk upsert — 개별 await N회 → 단일 DB 왕복
export const bulkUpsertGoogleEvents = async (
  events: Array<Omit<Event, 'id'> & { calendarUrl: string; source: 'google'; caldavUid?: string; etag?: string }>
): Promise<boolean> => {
  if (events.length === 0) return true;

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return false;

  const payloads = events.map(event => {
    const { startTime, endTime, calendarUrl, caldavUid, etag, endDate, ...rest } = event as any;
    const payload: any = {
      ...rest,
      start_time: startTime,
      end_time: endTime,
      memo: serializeMemo(rest.memo, endDate ? { endDate } : {}),
      source: 'google',
      user_id: userData.user!.id,
      calendar_url: normalizeCalendarUrl(calendarUrl) || calendarUrl,
    };
    delete payload.caldavUid;
    delete payload.endDate;
    if (caldavUid) payload.caldav_uid = caldavUid;
    if (etag) payload.etag = etag;
    return payload;
  });

  const { error } = await supabase
    .from('events')
    .upsert(payloads, { onConflict: 'user_id,caldav_uid,calendar_url' });

  if (error) {
    console.error('Error bulk upserting Google events:', error);
    return false;
  }
  return true;
};

// 구독 캘린더용 bulk upsert — 개별 upsert N회 → 단일 DB 왕복 (Auth 락 경합 방지)
export const bulkUpsertSubscriptionEvents = async (
  events: Array<Omit<Event, 'id'> & { calendarUrl: string; source?: 'caldav'; caldavUid?: string; endDate?: string }>
): Promise<boolean> => {
  if (events.length === 0) return true;

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return false;

  const payloads = events.map(event => {
    const { startTime, endTime, calendarUrl, caldavUid, endDate, ...rest } = event as any;
    const payload: any = {
      ...rest,
      start_time: startTime,
      end_time: endTime,
      memo: serializeMemo(rest.memo, endDate ? { endDate } : {}),
      source: 'caldav',
      user_id: userData.user!.id,
      calendar_url: normalizeCalendarUrl(calendarUrl) || calendarUrl,
    };
    delete payload.caldavUid;
    delete payload.endDate;
    if (caldavUid) payload.caldav_uid = caldavUid;
    return payload;
  });

  const { error } = await supabase
    .from('events')
    .upsert(payloads, { onConflict: 'user_id,caldav_uid,calendar_url' });

  if (error) {
    console.error('Error bulk upserting subscription events:', error);
    return false;
  }
  return true;
};

// Google sync용 bulk delete — 취소된 이벤트를 단일 쿼리로 일괄 삭제
export const bulkDeleteEventsByCaldavUids = async (
  caldavUids: string[],
  calendarUrl: string
): Promise<boolean> => {
  if (caldavUids.length === 0) return true;

  const normalizedUrl = normalizeCalendarUrl(calendarUrl) || calendarUrl;
  const { error } = await supabase
    .from('events')
    .delete()
    .in('caldav_uid', caldavUids)
    .eq('calendar_url', normalizedUrl);

  if (error) {
    console.error('Error bulk deleting events by caldav_uid:', error);
    return false;
  }
  return true;
};

export const updateEvent = async (id: string, updates: Partial<{
  title: string;
  memo?: string;
  startTime?: string;
  endTime?: string;
  endDate?: string;
  color: string;
  calendarUrl?: string;
}>) => {
  const payload: any = { ...updates };
  if (updates.startTime !== undefined) {
    payload.start_time = updates.startTime;
    delete payload.startTime;
  }
  if (updates.endTime !== undefined) {
    payload.end_time = updates.endTime;
    delete payload.endTime;
  }
  
  // Handle endDate & memo metadata logic
  // Handle endDate & memo metadata logic
  if (updates.endDate !== undefined) {
    // payload.end_date = updates.endDate; // REMOVED
    delete payload.endDate;

    // If endDate changed, we must update memo to store metadata
    let currentMemo = updates.memo;
    
    // If user didn't change memo (undefined), we fetch existing to preserve it
    if (currentMemo === undefined) {
      const { data: existing } = await supabase.from('events').select('memo').eq('id', id).single();
      if (existing) {
        const parsed = parseMemo(existing.memo);
        currentMemo = parsed.memo;
      }
    }
    payload.memo = serializeMemo(currentMemo, { endDate: updates.endDate });
  
  } else if (payload.memo !== undefined) {
    // Only memo changed. We must preserve existing endDate metadata.
    const { data: existing } = await supabase.from('events').select('memo').eq('id', id).single();
    if (existing) {
      const parsed = parseMemo(existing.memo);
      const existingEndDate = parsed.meta.endDate; // Only rely on Meta
      // If there was an endDate, re-serialize with it
      if (existingEndDate) {
        payload.memo = serializeMemo(payload.memo, { endDate: existingEndDate });
      } else {
        // No existing endDate, just clean memo? No, just use what user sent.
        // User sent raw memo text. serializeMemo will add meta if provided.
        // Here we provide nothing, so it cleans it? No, we should call serializeMemo to ensure format if we want consistency,
        // or just let it be. But serializeMemo also strips existing meta if we don't pass it.
        // So payload.memo is raw. If we save it directly, we lose meta.
        // So we MUST use serializeMemo here too.
        payload.memo = serializeMemo(payload.memo, {});
      }
    }
  }

  // calendarUrl -> calendar_url 매핑
  if ('calendarUrl' in updates) {
    payload.calendar_url = updates.calendarUrl;
    delete payload.calendarUrl;
  }

  // caldavUid -> caldav_uid 매핑
  if ('caldavUid' in updates) {
    payload.caldav_uid = (updates as any).caldavUid;
    delete payload.caldavUid;
  }

  const { data, error } = await supabase
    .from('events')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating event:', error);
    return null;
  }
  return {
    ...data,
    startTime: data.start_time,
    endTime: data.end_time,
    endDate: data.end_date, // This might be null if DB col missing, but we rely on fetchEvents to parse it next time
    calendarUrl: data.calendar_url,
  };
};

// Routines
export const fetchRoutines = async () => {
  const { data, error } = await supabase
    .from('routines')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching routines:', error);
    return [];
  }
  return (data || []).map((routine: any) => ({
    ...routine,
    createdAt: routine.created_at,
    deletedAt: routine.deleted_at,
  }));
};

export const createRoutine = async (routine: Omit<Routine, 'id'>) => {
  const { data, error } = await supabase
    .from('routines')
    .insert([routine])
    .select()
    .single();

  if (error) {
    console.error('Error creating routine:', error);
    return null;
  }
  return {
    ...data,
    createdAt: data.created_at,
  };
};

export const deleteRoutine = async (id: string) => {
  const { error } = await supabase
    .from('routines')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('Error deleting routine:', error);
    return false;
  }
  return true;
};

export const updateRoutine = async (id: string, updates: Partial<Omit<Routine, 'id'>>) => {
  const { data, error } = await supabase
    .from('routines')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating routine:', error);
    return null;
  }
  return {
    ...data,
    createdAt: data.created_at,
  } as Routine;
};

// Routine Completions
export const fetchRoutineCompletions = async () => {
  const { data, error } = await supabase
    .from('routine_completions')
    .select('*');

  if (error) {
    console.error('Error fetching completions:', error);
    return [];
  }
  // Map snake_case to camelCase if needed, but for now assuming direct match except table columns
  // Our SQL table has routine_id (snake_case). The App expects camelCase usually?
  // Let's check App.tsx types: routineId.
  // We need to map routine_id -> routineId.
  return (data || []).map((item: any) => ({
    ...item,
    routineId: item.routine_id,
  }));
};

export const toggleRoutineCompletion = async (routineId: string, date: string, completed: boolean) => {
  // Upsert logic
  // If exists, update. If not, insert.
  // But wait, if we toggle off, do we delete or set false?
  // The App logic: "completed: !rc.completed".
  // Database: completed boolean default false.
  
  const { data, error } = await supabase
    .from('routine_completions')
    .upsert(
      { routine_id: routineId, date, completed },
      { onConflict: 'routine_id,date' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error toggling routine:', error);
    return null;
  }
  return { ...data, routineId: data.routine_id };
};

// Todos
export const fetchTodos = async () => {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching todos:', error);
    return [];
  }
  return (data || []).map((item: any) => ({
    ...item,
    weekStart: item.week_start,
  }));
};

export const createTodo = async (todo: Omit<Todo, 'id'>) => {
  const { weekStart, ...rest } = todo as any; 
  // Map weekStart -> week_start
  const payload: any = {
    ...rest,
    week_start: todo.weekStart
  };

  // Remove undefined deadline
  if (payload.deadline === undefined) {
    delete payload.deadline;
  }

  const { data, error } = await supabase
    .from('todos')
    .insert([payload])
    .select()
    .single();

  if (error) {
    // Retry without deadline if column doesn't exist yet
    if (error.code === 'PGRST204' || error.message?.includes('deadline')) {
      console.warn('deadline column not found, retrying without it');
      delete payload.deadline;
      const { data: d2, error: e2 } = await supabase
        .from('todos')
        .insert([payload])
        .select()
        .single();
      if (e2) { console.error('Error creating todo (retry):', e2); return null; }
      return { ...d2, weekStart: d2.week_start };
    }
    console.error('Error creating todo:', error);
    return null;
  }
  return { ...data, weekStart: data.week_start };
};

export const updateTodo = async (id: string, updates: Partial<Todo>) => {
  const payload: any = { ...updates };
  if (updates.weekStart) {
    payload.week_start = updates.weekStart;
    delete payload.weekStart;
  }
  
  // deadline이 undefined이면 payload에서 제거 (변경 안함)
  // null이면 그대로 유지 (DB에서 삭제 의도)
  if (payload.deadline === undefined) {
    delete payload.deadline;
  }
  // Remove isNew flag — it's a client-only field
  delete payload.isNew;

  const { data, error } = await supabase
    .from('todos')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    // Retry without deadline if column doesn't exist yet
    if (error.code === 'PGRST204' || error.message?.includes('deadline')) {
      console.warn('deadline column not found, retrying without it');
      delete payload.deadline;
      const { data: d2, error: e2 } = await supabase
        .from('todos')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (e2) { console.error('Error updating todo (retry):', e2); return null; }
      return { ...d2, weekStart: d2.week_start };
    }
    console.error('Error updating todo:', error);
    return null;
  }
  return { ...data, weekStart: data.week_start };
};

export const deleteTodo = async (id: string) => {
  const { error } = await supabase
    .from('todos')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting todo:', error);
    return false;
  }
  return true;
};

// Batch update todo positions (for drag-and-drop reordering)
export const updateTodoPositions = async (todoPositions: { id: string; position: number }[]) => {
  try {
    // Use Promise.all for parallel updates
    await Promise.all(
      todoPositions.map(({ id, position }) =>
        supabase.from('todos').update({ position }).eq('id', id)
      )
    );
    return true;
  } catch (error) {
    console.error('Error updating todo positions:', error);
    return false;
  }
};

// Diary Entries
export const fetchDiaryEntry = async (date: string): Promise<DiaryEntry | null> => {
  const { data, error } = await supabase
    .from('diary_entries')
    .select('date, title, content, updated_at')
    .eq('date', date)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching diary entry:', error);
    return null;
  }

  if (!data) return null;

  return {
    date: data.date,
    title: data.title || '',
    content: data.content || '',
    updatedAt: data.updated_at,
  };
};

export const fetchDiaryEntriesByRange = async (startDate: string, endDate: string): Promise<DiaryEntry[]> => {
  const { data, error } = await supabase
    .from('diary_entries')
    .select('date, title, content, updated_at')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  if (error) {
    console.error('Error fetching diary entries:', error);
    return [];
  }

  return (data || []).map((item: any) => ({
    date: item.date,
    title: item.title || '',
    content: item.content || '',
    updatedAt: item.updated_at,
  }));
};

export const upsertDiaryEntry = async (date: string, title: string, content: string): Promise<DiaryEntry | null> => {
  const { data, error } = await supabase
    .from('diary_entries')
    .upsert(
      { date, title, content, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    )
    .select('date, title, content, updated_at')
    .single();

  if (error) {
    console.error('Error saving diary entry:', error);
    return null;
  }

  return {
    date: data.date,
    title: data.title || '',
    content: data.content || '',
    updatedAt: data.updated_at,
  };
};

export const deleteDiaryEntry = async (date: string): Promise<boolean> => {
  const { error } = await supabase
    .from('diary_entries')
    .delete()
    .eq('date', date);

  if (error) {
    console.error('Error deleting diary entry:', error);
    return false;
  }
  return true;
};



// Emotion Entries
export const fetchEmotionEntriesByRange = async (startDate: string, endDate: string): Promise<Record<string, string>> => {
  const { data, error } = await supabase
    .from('emotion_entries')
    .select('date, emotion')
    .gte('date', startDate)
    .lte('date', endDate);

  if (error) {
    console.error('Error fetching emotion entries:', error);
    return {};
  }

  return (data || []).reduce((acc: Record<string, string>, row: any) => {
    acc[row.date] = row.emotion;
    return acc;
  }, {});
};

export const upsertEmotionEntry = async (date: string, emotion: string): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase
    .from('emotion_entries')
    .upsert(
      { user_id: user.id, date, emotion, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    );

  if (error) {
    console.error('Error saving emotion entry:', error);
    return false;
  }
  return true;
};

export const deleteEmotionEntry = async (date: string): Promise<boolean> => {
  const { error } = await supabase
    .from('emotion_entries')
    .delete()
    .eq('date', date);

  if (error) {
    console.error('Error deleting emotion entry:', error);
    return false;
  }
  return true;
};

// CalDAV Sync Settings
export interface CalDAVSyncSettings {
  id: string;
  serverUrl: string;
  username: string;
  password: string;
  selectedCalendarUrls: string[];
  syncIntervalMinutes: number;
  enabled: boolean;
  lastSyncAt?: string;
}

export const getCalDAVSyncSettings = async (): Promise<CalDAVSyncSettings | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  try {
    // RLS가 자동으로 user_id를 필터링하므로 .eq('user_id', user.id) 제거
    const { data, error } = await supabase
      .from('caldav_sync_settings')
      .select('*')
      .maybeSingle(); // .single() 대신 .maybeSingle() 사용 (없으면 null 반환)

    if (error) {
      // PGRST116은 "no rows returned"이므로 정상적인 경우
      if (error.code === 'PGRST116' || error.message?.includes('No rows')) {
        return null;
      }
      console.error('Error fetching CalDAV sync settings:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    return {
      id: data.id,
      serverUrl: data.server_url,
      username: data.username,
      password: data.password,
      selectedCalendarUrls: data.selected_calendar_urls || [],
      syncIntervalMinutes: data.sync_interval_minutes || 60,
      enabled: data.enabled,
      lastSyncAt: data.last_sync_at,
    };
  } catch (err: any) {
    console.error('Unexpected error fetching CalDAV sync settings:', err);
    return null;
  }
};

export const deleteCalDAVSyncSettings = async (): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  console.log("Deleting CalDAV settings for user:", user.id);
  const { error } = await supabase
    .from('caldav_sync_settings')
    .delete()
    .eq('user_id', user.id); // Assuming RLS allows deleting own records

  if (error) {
    console.error('Error deleting CalDAV settings:', error);
    return false;
  }
  return true;
};

export const saveCalDAVSyncSettings = async (settings: {
  serverUrl: string;
  username: string;
  password: string;
  selectedCalendarUrls: string[];
  syncIntervalMinutes?: number;
}): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  // 비밀번호가 비어있으면 기존 저장된 값 유지 (동기화/캘린더 선택 시 덮어쓰기 방지)
  let passwordToSave = settings.password;
  if (!passwordToSave || passwordToSave.trim() === '') {
    const existing = await getCalDAVSyncSettings();
    if (existing?.password) {
      passwordToSave = existing.password;
    }
  }

  const { error } = await supabase
    .from('caldav_sync_settings')
    .upsert({
      user_id: user.id,
      server_url: settings.serverUrl,
      username: settings.username,
      password: passwordToSave,
      selected_calendar_urls: settings.selectedCalendarUrls,
      sync_interval_minutes: settings.syncIntervalMinutes || 60,
      enabled: true,
      last_sync_at: null,
    }, {
      onConflict: 'user_id',
    });

  if (error) {
    console.error('Error saving CalDAV sync settings:', error);
    return false;
  }
  return true;
};

/** selectedCalendarUrls만 갱신 (비밀번호 등 다른 필드 건드리지 않음 — 인증 오염 방지) */
export const updateCalDAVSelectedCalendars = async (selectedCalendarUrls: string[]): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from('caldav_sync_settings')
    .update({ selected_calendar_urls: selectedCalendarUrls })
    .eq('user_id', user.id);

  if (error) {
    console.error('Error updating CalDAV selected calendars:', error);
    return false;
  }
  return true;
};

export const updateLastSyncTime = async (): Promise<void> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('caldav_sync_settings')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('user_id', user.id);
};

export const deleteAllCalDAVData = async (): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  // 1. 자격증명(server_url, username, password)은 유지하고
  //    선택된 캘린더 목록과 last_sync_at만 초기화 → 재연결 시 비밀번호 재입력 불필요
  const { error: settingsError } = await supabase
    .from('caldav_sync_settings')
    .update({
      selected_calendar_urls: [],
      last_sync_at: null,
      enabled: false,
    })
    .eq('user_id', user.id);

  if (settingsError) {
    console.error('Error resetting sync settings:', settingsError);
    return false;
  }

  // 2. CalDAV 이벤트 삭제
  const { error: eventsError } = await supabase
    .from('events')
    .delete()
    .eq('source', 'caldav');

  if (eventsError) {
    console.error('Error deleting CalDAV events:', eventsError);
    return false;
  }

  // 3. calendar_metadata에서 CalDAV 캘린더 삭제
  // type='caldav' 또는 type=null(오래된 데이터) 중 http:// URL인 것 — google/local/subscription 제외
  const { error: metaError } = await supabase
    .from('calendar_metadata')
    .delete()
    .eq('user_id', user.id)
    .or('type.eq.caldav,type.is.null')
    .not('url', 'like', 'google:%')
    .not('url', 'like', 'local:%')
    .not('is_subscription', 'eq', true);

  if (metaError) {
    console.error('Error deleting CalDAV calendar metadata:', metaError);
    return false;
  }

  return true;
};

export const deleteAllGoogleData = async (): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error: eventsError } = await supabase
    .from('events')
    .delete()
    .eq('source', 'google');

  if (eventsError) {
    console.error('Error deleting Google events:', eventsError);
    return false;
  }

  // Google 캘린더 메타데이터 삭제 (사이드바에서 제거)
  const { error: metaError } = await supabase
    .from('calendar_metadata')
    .delete()
    .eq('user_id', user.id)
    .eq('type', 'google');

  if (metaError) {
    console.error('Error deleting Google calendar metadata:', metaError);
    return false;
  }

  // user_tokens 테이블에서 저장된 Google refresh token 삭제
  await supabase
    .from('user_tokens')
    .delete()
    .eq('user_id', user.id);

  // 웹훅 채널도 정리 (해제 후 불필요한 웹훅 신호 방지)
  await supabase
    .from('google_watch_channels')
    .delete()
    .eq('user_id', user.id);

  return true;
};

/** 동기화 해제 시 해당 캘린더의 이벤트 일괄 삭제 (calendar_url 기준, 정규화/비정규화 모두 처리) */
export const deleteEventsByCalendarUrl = async (calendarUrl: string): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const normUrl = normalizeCalendarUrl(calendarUrl) || calendarUrl;
  const urlsToTry = [...new Set([normUrl, calendarUrl].filter(Boolean))];
  if (urlsToTry.length === 0) return true;

  // PostgREST .in() 대신 각 URL별로 삭제 (호환성·RLS 이슈 회피)
  for (const url of urlsToTry) {
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('calendar_url', url);

    if (error) {
      console.error('Error deleting events by calendar_url:', url, error);
      return false;
    }
  }
  return true;
};

// 중복 이벤트 체크
export const eventExists = async (
  event: Omit<Event, 'id'>,
  calendarUrl?: string | null,
  source: string = 'caldav'
): Promise<boolean> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);

  const query = supabase
    .from('events')
    .select('id')
    .eq('title', event.title)
    .eq('date', event.date)
    .in('source', [source, null]) // 과거에 source가 null인 caldav 데이터도 중복 체크
    .limit(1);

  // start_time과 end_time도 비교 (null 처리)
  if (event.startTime) {
    query.eq('start_time', event.startTime);
  } else {
    query.is('start_time', null);
  }

  if (event.endTime) {
    query.eq('end_time', event.endTime);
  } else {
    query.is('end_time', null);
  }

  if (normalizedCalendarUrl) {
    query.eq('calendar_url', normalizedCalendarUrl);
  }

  const { data, error } = await query.maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error checking event existence:', error);
    return false;
  }

  return data !== null;
};

// 중복 이벤트 삭제
export const deleteDuplicateEvents = async (): Promise<number> => {
  // 모든 이벤트 가져오기
  const { data: events, error: fetchError } = await supabase
    .from('events')
    .select('*')
    .order('date', { ascending: true });

  if (fetchError || !events) {
    console.error('Error fetching events for deduplication:', fetchError);
    return 0;
  }

  // 중복 찾기 (제목, 날짜, 시작 시간, 종료 시간이 모두 같은 경우)
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const event of events) {
    const normalizedCalendarUrl = normalizeCalendarUrl(event.calendar_url || event.calendarUrl || null) || '';
    const source = event.source || '';

    // caldav_uid 우선 기준
    if (event.caldav_uid) {
      const key = `uid|${event.caldav_uid}|${normalizedCalendarUrl}`;
      if (seen.has(key)) {
        duplicates.push(event.id);
      } else {
        seen.add(key);
      }
      continue;
    }

    // 중복 체크 키 생성 (제목|날짜|시작시간|종료시간)
    const startTime = event.start_time || '';
    const endTime = event.end_time || '';
    const key = `meta|${event.title}|${event.date}|${startTime}|${endTime}|${normalizedCalendarUrl}|${source}`;
    
    if (seen.has(key)) {
      duplicates.push(event.id);
    } else {
      seen.add(key);
    }
  }

  // 중복 삭제 (배치로 처리)
  if (duplicates.length > 0) {
    const batchSize = 50;
    let deletedCount = 0;
    
    for (let i = 0; i < duplicates.length; i += batchSize) {
      const batch = duplicates.slice(i, i + batchSize);
      const { error: deleteError } = await supabase
        .from('events')
        .delete()
        .in('id', batch);

      if (deleteError) {
        console.error(`Error deleting duplicate batch ${Math.floor(i / batchSize) + 1}:`, deleteError);
        continue;
      }
      
      deletedCount += batch.length;
    }
    
    return deletedCount;
  }

  return 0;
};
