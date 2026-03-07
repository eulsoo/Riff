import type { CalendarMetadata } from './api';
import { normalizeCalendarUrl } from './api';
import type { CalDAVConfig } from './caldav';

export interface CalDAVSyncSettingsLike {
  serverUrl: string;
  username: string;
  password?: string;
  id?: string | null;
  selectedCalendarUrls?: string[];
}

export const isCalDAVAuthErrorMessage = (message: string): boolean =>
  message.includes('인증에 실패') || message.includes('애플 계정');

export const isCalDAVSyncTarget = (calendar: CalendarMetadata): boolean => {
  if (!calendar.url.startsWith('http')) return false;
  if (calendar.url.startsWith('local-')) return false;
  if (calendar.isSubscription || calendar.type === 'subscription') return false;
  if (calendar.url.endsWith('.ics')) return false;
  return true;
};

export const isSubscriptionLikeCalendar = (
  calendar?: Pick<CalendarMetadata, 'type' | 'isSubscription' | 'url'> | null
): boolean => {
  if (!calendar) return false;
  const url = calendar.url || '';
  return calendar.type === 'subscription' || Boolean(calendar.isSubscription) || url.includes('holidays') || url.endsWith('.ics');
};

export const isWritableCalendar = (
  calendar: Pick<CalendarMetadata, 'type' | 'isSubscription' | 'url' | 'readOnly'>
): boolean => !isSubscriptionLikeCalendar(calendar) && !calendar.readOnly;

export const normalizeSelectedCalDAVUrlSet = (urls?: string[]): Set<string> =>
  new Set((urls || []).map((url: string) => normalizeCalendarUrl(url) || url));

export const getCalDAVSyncTargets = (
  calendars: CalendarMetadata[],
  selectedUrls?: string[]
): CalendarMetadata[] => {
  const selectedSet = normalizeSelectedCalDAVUrlSet(selectedUrls);
  return calendars.filter((calendar) => {
    if (!isCalDAVSyncTarget(calendar)) return false;
    if (selectedSet.size === 0) return true;
    const normalized = normalizeCalendarUrl(calendar.url) || calendar.url;
    return selectedSet.has(normalized);
  });
};

export const buildCalDAVConfigFromSettings = (
  settings: CalDAVSyncSettingsLike
): CalDAVConfig => ({
  serverUrl: settings.serverUrl,
  username: settings.username,
  password: settings.password,
  settingId: settings.id || undefined,
});
