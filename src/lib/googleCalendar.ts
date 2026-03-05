import { supabase } from './supabase';
import { Event } from '../types';

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

export interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end:   { dateTime?: string; date?: string; timeZone?: string };
  status?: string;       // "confirmed" | "tentative" | "cancelled"
  iCalUID?: string;
  etag?: string;
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

export const clearGoogleSyncToken = (calendarId: string) => {
  const tokens = loadGoogleSyncTokens();
  delete tokens[calendarId];
  saveGoogleSyncTokens(tokens);
};

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────

/**
 * Returns the Google OAuth access_token from the current Supabase session.
 * Only available when the user logged in with Google provider.
 */
export const getGoogleProviderToken = async (): Promise<string | null> => {
  const { data: { session } } = await supabase.auth.getSession();
  let token = session?.provider_token ?? null;

  // token is null if provider_token expired/removed during standard Supabase session refresh
  if (!token) {
    try {
      const { data, error } = await supabase.functions.invoke('refresh-google-token', {
        method: 'POST',
      });

      if (!error && data?.access_token) {
        token = data.access_token as string;
      }
    } catch (e) {
      console.error('Failed to refresh Google provider token via edge function', e);
    }
  }

  return token;
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
    timeMin?: string;    // ISO 8601 (used for full fetch)
    timeMax?: string;    // ISO 8601
    syncToken?: string;  // if present, ignores timeMin/timeMax
  }
): Promise<GoogleEventsResponse> => {
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  const query = new URLSearchParams({
    maxResults: '2500',
    singleEvents: 'true',
    orderBy: 'startTime',
  });

  if (params.syncToken) {
    query.set('syncToken', params.syncToken);
  } else {
    if (params.timeMin) query.set('timeMin', params.timeMin);
    if (params.timeMax) query.set('timeMax', params.timeMax);
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
    color,
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

