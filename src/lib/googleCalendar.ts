import { supabase } from './supabase';
import { Event } from '../types';

// ─────────────────────────────────────────────────────────────
// Google Watch Channel Registration
// ─────────────────────────────────────────────────────────────

/**
 * Google Calendar Watch 채널을 등록한다.
 * 실패 시 에러를 던지지 않고 조용히 무시 — 폴링 fallback으로 동작.
 */
export const registerGoogleWatchChannel = async (calendarId: string, color?: string): Promise<void> => {
  try {
    const { error } = await supabase.functions.invoke('google-watch-register', {
      body: { calendarIds: [calendarId], colors: { [calendarId]: color ?? '#4285F4' } },
    });
    if (error) {
      console.warn('[Google Watch] 채널 등록 실패 (폴링 fallback):', error);
    }
  } catch (e) {
    console.warn('[Google Watch] 채널 등록 실패 (폴링 fallback):', e);
  }
};

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface GoogleCalendar {
  id: string;           // e.g. "primary" or "xxx@group.calendar.google.com"
  summary: string;      // display name
  backgroundColor: string;
  foregroundColor: string;
  accessRole: string;   // "owner" | "writer" | "reader" | "freeBusyReader"
  primary?: boolean;
  selected?: boolean;
}

export interface GoogleCalendarMutationError extends Error {
  code?: 'AUTH' | 'FORBIDDEN' | 'UNKNOWN';
}

export interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end:   { dateTime?: string; date?: string; timeZone?: string };
  status?: string;       // "confirmed" | "tentative" | "cancelled"
  iCalUID?: string;
  etag?: string;
  colorId?: string;      // 이벤트별 색상 ID (1~11)
}

export interface GoogleEventsResponse {
  events: GoogleEvent[];
  nextSyncToken?: string;
  nextPageToken?: string;
}

// ─────────────────────────────────────────────────────────────
// LocalStorage Keys
// ─────────────────────────────────────────────────────────────

const GOOGLE_SYNC_TOKENS_KEY = 'googleSyncTokens'; // calendarId -> syncToken map
const GOOGLE_LAST_SYNC_TIMES_KEY = 'googleLastSyncTimes'; // calendarId -> ISO timestamp

export const loadGoogleSyncTokens = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(GOOGLE_SYNC_TOKENS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export const saveGoogleSyncTokens = (tokens: Record<string, string>) => {
  try {
    localStorage.setItem(GOOGLE_SYNC_TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    // ignore
  }
};

/** 마지막 구글 캘린더 sync 시각 로드 (calendarId → ISO timestamp) */
export const loadGoogleLastSyncTimes = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(GOOGLE_LAST_SYNC_TIMES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

/** 마지막 구글 캘린더 sync 시각 저장 */
export const saveGoogleLastSyncTimes = (times: Record<string, string>) => {
  try {
    localStorage.setItem(GOOGLE_LAST_SYNC_TIMES_KEY, JSON.stringify(times));
  } catch {
    // ignore
  }
};

export const clearGoogleSyncToken = (calendarId: string) => {
  const tokens = loadGoogleSyncTokens();
  delete tokens[calendarId];
  saveGoogleSyncTokens(tokens);
};

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────

// 메모리 캐시: Edge Function에서 받은 access_token과 만료 시각 저장
let cachedToken: string | null = null;
let cachedTokenExpiry: number = 0;
let edgeFunctionFailed = false; // 한 번 실패하면 주기 동안 재시도 안 함
let edgeFunctionRetryAt: number = 0;

/** 캐시된 토큰을 초기화 (로그아웃 등에서 사용) */
export const clearCachedGoogleToken = () => {
  cachedToken = null;
  cachedTokenExpiry = 0;
  edgeFunctionFailed = false;
  edgeFunctionRetryAt = 0;
};

/**
 * Returns the Google OAuth access_token from the current Supabase session.
 * - 세션에 provider_token이 있으면 그것을 사용
 * - 없으면 Edge Function으로 갱신 시도 (55분 캐시)
 * - Edge Function 실패 시 10분 동안 재시도 안 함
 */
export const getGoogleProviderToken = async (): Promise<string | null> => {
  const { data: { session } } = await supabase.auth.getSession();

  // Google 계정이 전혀 없는 유저 (예: 카카오 전용)는 즉시 반환
  const hasGoogleProvider =
    session?.user?.app_metadata?.providers?.includes('google') ||
    session?.user?.app_metadata?.provider === 'google';
  if (!hasGoogleProvider) return null;

  // 현재 세션이 Google OAuth로 로그인된 경우에만 provider_token을 Google 토큰으로 사용
  // (카카오로 로그인했을 때 provider_token은 카카오 토큰이므로 사용하면 안 됨)
  const isCurrentlyGoogleSession = session?.user?.app_metadata?.provider === 'google';
  if (isCurrentlyGoogleSession && session?.provider_token) {
    cachedToken = null;
    cachedTokenExpiry = 0;
    return session.provider_token;
  }

  // 메모리 캐시에 유효한 토큰이 있으면 재사용 (Edge Function 호출 최소화)
  const now = Date.now();
  if (cachedToken && cachedTokenExpiry > now) {
    return cachedToken;
  }

  // Edge Function 최근 실패 시 10분간 재시도 안 함 (401 루프 방지)
  if (edgeFunctionFailed && edgeFunctionRetryAt > now) {
    return null;
  }

  // Edge Function으로 토큰 갱신 시도 (카카오+구글 연동 계정, 또는 세션 만료)
  try {
    const { data, error } = await supabase.functions.invoke('refresh-google-token', {
      method: 'POST',
    });

    if (!error && data?.access_token) {
      cachedToken = data.access_token as string;
      const expiresIn = (data.expires_in as number | undefined) ?? 3300;
      cachedTokenExpiry = now + (expiresIn - 60) * 1000;
      edgeFunctionFailed = false;
      return cachedToken;
    } else {
      edgeFunctionFailed = true;
      edgeFunctionRetryAt = now + 10 * 60 * 1000;
      return null;
    }
  } catch (e) {
    console.error('Failed to refresh Google provider token via edge function', e);
    edgeFunctionFailed = true;
    edgeFunctionRetryAt = now + 10 * 60 * 1000;
    return null;
  }
};



/**
 * Returns true if the current user logged in through Google OAuth.
 */
export const isGoogleUser = async (): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  return user.app_metadata?.providers?.includes('google') === true ||
    user.app_metadata?.provider === 'google';
};

// ─────────────────────────────────────────────────────────────
// Calendar List
// ─────────────────────────────────────────────────────────────

/**
 * Fetches the list of calendars available to the user from Google.
 */
export const fetchGoogleCalendarList = async (token: string): Promise<GoogleCalendar[]> => {
  const url = 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader';
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`fetchGoogleCalendarList failed: ${res.status} ${err.error?.message ?? ''}`);
  }

  const data = await res.json();
  return (data.items ?? []) as GoogleCalendar[];
};

export interface CreatedGoogleCalendar {
  id: string;
  summary: string;
  backgroundColor?: string;
}

export const createGoogleCalendar = async (
  token: string,
  summary: string,
  backgroundColor?: string
): Promise<CreatedGoogleCalendar> => {
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary,
      backgroundColor,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const error = new Error(
      `createGoogleCalendar failed: ${res.status} ${err.error?.message ?? ''}`
    ) as GoogleCalendarMutationError;
    if (res.status === 401) error.code = 'AUTH';
    else if (res.status === 403) error.code = 'FORBIDDEN';
    else error.code = 'UNKNOWN';
    throw error;
  }

  const data = await res.json();
  return {
    id: data.id,
    summary: data.summary,
    backgroundColor: data.backgroundColor,
  };
};

export const deleteGoogleCalendar = async (
  token: string,
  calendarId: string
): Promise<void> => {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 204 || res.status === 404) return;

  const err = await res.json().catch(() => ({}));
  const error = new Error(
    `deleteGoogleCalendar failed: ${res.status} ${err.error?.message ?? ''}`
  ) as GoogleCalendarMutationError;
  if (res.status === 401) error.code = 'AUTH';
  else if (res.status === 403) error.code = 'FORBIDDEN';
  else error.code = 'UNKNOWN';
  throw error;
};

// ─────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────

/**
 * Fetches events from a Google Calendar.
 * If syncToken is provided, performs incremental sync (only changed items).
 * Otherwise performs a full fetch for the given time range.
 */
export const fetchGoogleEvents = async (
  token: string,
  calendarId: string,
  params: {
    timeMin?: string;     // ISO 8601 (used for full fetch)
    timeMax?: string;     // ISO 8601
    syncToken?: string;   // if present, ignores timeMin/timeMax
    updatedMin?: string;  // ISO 8601 — 이 시각 이후 변경된 이벤트만 반환 (증분 동기화)
  }
): Promise<GoogleEventsResponse> => {
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  const query = new URLSearchParams({
    maxResults: '2500',
    singleEvents: 'true',
    showDeleted: 'true',  // cancelled 이벤트 포함 (폴링으로도 삭제 감지)
    // orderBy: 'startTime' — showDeleted와 병용 불가 (cancelled 이벤트는 start 필드 없음)
  });

  if (params.syncToken) {
    query.set('syncToken', params.syncToken);
  } else {
    if (params.timeMin) query.set('timeMin', params.timeMin);
    if (params.timeMax) query.set('timeMax', params.timeMax);
    // updatedMin: 마지막 sync 이후 변경된 이벤트만 fetch (full sync 반복 방지)
    if (params.updatedMin) query.set('updatedMin', params.updatedMin);
  }

  let allEvents: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  // paginate through all results
  do {
    if (pageToken) query.set('pageToken', pageToken);

    const res = await fetch(`${baseUrl}?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // 410 Gone means syncToken is invalid – caller should do a full re-sync
    if (res.status === 410) {
      throw new Error('SYNC_TOKEN_INVALID');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`fetchGoogleEvents failed: ${res.status} ${err.error?.message ?? ''}`);
    }

    const data = await res.json();
    allEvents = allEvents.concat((data.items ?? []) as GoogleEvent[]);
    nextSyncToken = data.nextSyncToken;
    pageToken = data.nextPageToken;
  } while (pageToken);

  return { events: allEvents, nextSyncToken };
};

// ─────────────────────────────────────────────────────────────
// Google Color ID → Hex mapping
// ─────────────────────────────────────────────────────────────

const GOOGLE_COLOR_MAP: Record<string, string> = {
  '1':  '#ac725e', // Tomato
  '2':  '#d06b64', // Flamingo
  '3':  '#f83a22', // Tangerine
  '4':  '#fa573c', // Banana
  '5':  '#ff7537', // Sage
  '6':  '#ffad46', // Basil
  '7':  '#42d692', // Peacock
  '8':  '#16a765', // Blueberry
  '9':  '#7bd148', // Lavender
  '10': '#b3dc6c', // Grape
  '11': '#9fc6e7', // Graphite
};

export const googleColorIdToHex = (colorId?: string, fallback = '#4285F4'): string => {
  if (!colorId) return fallback;
  return GOOGLE_COLOR_MAP[colorId] ?? fallback;
};

// ─────────────────────────────────────────────────────────────
// Mapper: Google Event → Riff Event
// ─────────────────────────────────────────────────────────────

/**
 * Converts a raw Google Calendar event object into Riff's Event format.
 * Returns null for cancelled events (they should be deleted from DB).
 */
export const mapGoogleEventToRiff = (
  gEvent: GoogleEvent,
  calendarId: string,
  color: string
): (Omit<Event, 'id'> & { calendarUrl: string; source: 'google' }) | null => {
  // skip cancelled events (they need to be deleted separately)
  if (gEvent.status === 'cancelled') return null;

  // All-day event: start/end are date strings like "2024-03-04"
  const isAllDay = Boolean(gEvent.start.date);

  const startDateStr = isAllDay
    ? gEvent.start.date!
    : (gEvent.start.dateTime ?? '').slice(0, 10); // "YYYY-MM-DD"

  const endDateStr = isAllDay
    ? (() => {
        // Google all-day end date is exclusive, so subtract 1 day
        const d = new Date(gEvent.end.date!);
        d.setDate(d.getDate() - 1);
        return d.toISOString().slice(0, 10);
      })()
    : (gEvent.end.dateTime ?? '').slice(0, 10);

  const startTime = isAllDay
    ? undefined
    : (gEvent.start.dateTime ?? '').slice(11, 16); // "HH:MM"

  const endTime = isAllDay
    ? undefined
    : (gEvent.end.dateTime ?? '').slice(11, 16); // "HH:MM"

  // multi-day: endDate is different from startDate
  const endDate =
    endDateStr && endDateStr !== startDateStr ? endDateStr : undefined;

  return {
    date: startDateStr,
    title: gEvent.summary ?? '(제목 없음)',
    memo: gEvent.description,
    startTime,
    endTime,
    endDate,
    color: gEvent.colorId ? googleColorIdToHex(gEvent.colorId, color) : color,
    calendarUrl: `google:${calendarId}`,
    caldavUid: gEvent.id,            // reuse caldavUid field as the google event ID
    source: 'google',
    etag: gEvent.etag,
  };
};

// ─────────────────────────────────────────────────────────────
// Write: Upload Riff event → Google Calendar
// ─────────────────────────────────────────────────────────────

/**
 * Creates or updates a Riff event on Google Calendar.
 * Returns the Google event ID on success, null on failure.
 */
export const uploadEventToGoogle = async (
  token: string,
  calendarId: string,
  event: Event
): Promise<string | null> => {
  const isAllDay = !event.startTime;

  const body: Record<string, unknown> = {
    summary: event.title,
    description: event.memo || undefined,
  };

  if (isAllDay) {
    // Google all-day end is exclusive → add 1 day
    const endD = new Date(event.endDate ?? event.date);
    endD.setDate(endD.getDate() + 1);
    body.start = { date: event.date };
    body.end   = { date: endD.toISOString().slice(0, 10) };
  } else {
    // Parse local time and convert to UTC ISO string (e.g. 2026-03-04T00:00:00.000Z)
    const startIso = new Date(`${event.date}T${event.startTime}:00`).toISOString();
    const endDateStr = event.endDate ?? event.date;
    const endTimeStr = event.endTime ?? event.startTime;
    const endIso = new Date(`${endDateStr}T${endTimeStr}:00`).toISOString();

    body.start = { dateTime: startIso };
    body.end   = { dateTime: endIso };
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('uploadEventToGoogle failed:', res.status, err);
    return null;
  }

  const data = await res.json();
  return data.id as string;
};

/**
 * Deletes an event from Google Calendar by its Google event ID.
 */
export const deleteEventFromGoogle = async (
  token: string,
  calendarId: string,
  googleEventId: string
): Promise<boolean> => {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  // 204 No Content = success; 410 Gone = already deleted
  return res.status === 204 || res.status === 410;
};

/**
 * Updates an event in Google Calendar by its Google event ID.
 */
export const updateEventInGoogle = async (
  token: string,
  calendarId: string,
  googleEventId: string,
  event: Event
): Promise<boolean> => {
  const isAllDay = !event.startTime;

  const body: Record<string, unknown> = {
    summary: event.title,
    description: event.memo || undefined,
  };

  if (isAllDay) {
    const endD = new Date(event.endDate ?? event.date);
    endD.setDate(endD.getDate() + 1);
    body.start = { date: event.date };
    body.end   = { date: endD.toISOString().slice(0, 10) };
  } else {
    const startIso = new Date(`${event.date}T${event.startTime}:00`).toISOString();
    const endDateStr = event.endDate ?? event.date;
    const endTimeStr = event.endTime ?? event.startTime;
    const endIso = new Date(`${endDateStr}T${endTimeStr}:00`).toISOString();

    body.start = { dateTime: startIso };
    body.end   = { dateTime: endIso };
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('updateEventInGoogle failed:', res.status, err);
    return false;
  }

  return true;
};

