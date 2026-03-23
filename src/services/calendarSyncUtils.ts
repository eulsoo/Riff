import type { CalendarMetadata } from './api';
import { normalizeCalendarUrl, getCalDAVSyncSettings } from './api';
import type { CalDAVConfig } from './caldav';
import { getCalendars } from './caldav';
import { relinkEventsByCalendarUrl } from './calendarEventRelink';

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

// ─── 공통 CalDAV 서버 캘린더 체크 로직 ─────────────────────────────────────
// 초기 로드 / 팝업 오픈 시 두 곳에서 동일한 흐름이 사용됨:
//   getSettings → getCalendars → refreshMetadataWithServerList → relinkEvents → toast
export interface CalDAVServerCheckDeps {
  refreshMetadataWithServerList: (
    serverCalendars: { url: string; displayName?: string }[]
  ) => {
    urlRemap: Map<string, string>;
    deletedCalendars: string[];
    restoredCalendars: string[];
  };
  loadData: (force?: boolean) => void;
  onClearAuthError: () => void;
  onRestoredCalendar: (name: string) => void;
  onDeletedCalendar: (name: string) => void;
}

export const runCalDAVServerCheck = async (
  tag: string,
  deps: CalDAVServerCheckDeps
): Promise<void> => {
  const settings = await getCalDAVSyncSettings();
  if (!settings) return;

  const config = buildCalDAVConfigFromSettings(settings);
  const serverCalendars = await getCalendars(config);

  deps.onClearAuthError();

  const { urlRemap, restoredCalendars, deletedCalendars } =
    deps.refreshMetadataWithServerList(serverCalendars);

  if (urlRemap.size > 0) {
    await relinkEventsByCalendarUrl(urlRemap, tag);
    deps.loadData(true);
  }

  for (const name of restoredCalendars) {
    deps.onRestoredCalendar(name);
  }
  for (const name of deletedCalendars) {
    deps.onDeletedCalendar(name);
  }
};
