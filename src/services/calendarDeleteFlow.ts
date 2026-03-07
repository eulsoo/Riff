import { supabase } from '../lib/supabase';
import { CalendarMetadata, getCalDAVSyncSettings, normalizeCalendarUrl, deleteEventsByCalendarUrl, updateCalDAVSelectedCalendars } from './api';
import { clearCalDAVSyncTokenForCalendar, deleteRemoteCalendar } from './caldav';
import { isCalDAVSyncTarget } from './calendarSyncUtils';

export interface CalendarDeleteState {
  isOpen: boolean;
  url: string;
  name: string;
  isCalDAV: boolean;
  isUnsync?: boolean;
  isGoogle?: boolean;
}

export const buildCalendarDeleteState = (
  url: string,
  actionType: 'unsync' | 'delete' | undefined,
  calendarMetadata: CalendarMetadata[],
  googleCalendars: CalendarMetadata[]
): CalendarDeleteState | null => {
  if (url.startsWith('google:')) {
    const cal = googleCalendars.find(c => c.url === url);
    const name = cal?.displayName || '캘린더';
    if (actionType === 'unsync') {
      return {
        isOpen: true,
        url,
        name,
        isCalDAV: false,
        isUnsync: true,
        isGoogle: true,
      };
    }
    return null; // Google은 삭제 미지원
  }

  const calendar = calendarMetadata.find(c => c.url === url);
  if (!calendar) return null;

  if (actionType === 'unsync') {
    return {
      isOpen: true,
      url,
      name: calendar.displayName || '캘린더',
      isCalDAV: true,
      isUnsync: true,
    };
  }

  return {
    isOpen: true,
    url,
    name: calendar.displayName || '캘린더',
    isCalDAV: isCalDAVSyncTarget(calendar) && !calendar.readOnly,
    isUnsync: false,
  };
};

interface UnsyncFlowParams {
  url: string;
  isGoogle?: boolean;
  markUnsyncedUrl: (url: string) => void;
  removeGoogleCalendar: (calendarId: string) => void;
  deleteCalendar: (url: string) => void;
  loadData: (force?: boolean, excludeCalendarUrls?: string[]) => Promise<void>;
  setToast: (toast: { message: string; type: 'loading' | 'success' | 'error' } | null) => void;
}

export const runCalendarUnsyncFlow = async ({
  url,
  isGoogle,
  markUnsyncedUrl,
  removeGoogleCalendar,
  deleteCalendar,
  loadData,
  setToast,
}: UnsyncFlowParams): Promise<void> => {
  markUnsyncedUrl(url);
  markUnsyncedUrl(normalizeCalendarUrl(url) || url);

  if (isGoogle) {
    const id = url.replace('google:', '');
    removeGoogleCalendar(id);
    try {
      await deleteEventsByCalendarUrl(url);
      await loadData(true, [url]);
      setToast({ message: '구글 캘린더 동기화가 해제되었습니다.', type: 'success' });
    } catch (e) {
      console.error('Google unsync cleanup error:', e);
      setToast({ message: '동기화 해제 중 오류가 발생했습니다.', type: 'error' });
    }
    return;
  }

  deleteCalendar(url);
  try {
    const settings = await getCalDAVSyncSettings();
    if (settings) {
      clearCalDAVSyncTokenForCalendar(
        { serverUrl: settings.serverUrl, username: settings.username, password: settings.password, settingId: settings.id },
        url
      );
    }
    await deleteEventsByCalendarUrl(url);
    if (settings?.selectedCalendarUrls?.length) {
      const norm = normalizeCalendarUrl(url);
      const filtered = settings.selectedCalendarUrls.filter(
        u => normalizeCalendarUrl(u) !== norm && u !== url
      );
      if (filtered.length !== settings.selectedCalendarUrls.length) {
        await updateCalDAVSelectedCalendars(filtered);
      }
    }
    await loadData(true, [url, normalizeCalendarUrl(url) || url]);
    setToast({ message: '동기화가 해제되었습니다.', type: 'success' });
  } catch (e) {
    console.error('Unsync cleanup error:', e);
    setToast({ message: '동기화 해제 중 오류가 발생했습니다.', type: 'error' });
  }
};

interface DeleteFlowParams {
  url: string;
  deleteFromServer: boolean;
  deleteCalendar: (url: string) => void;
}

export const runCalendarDeleteFlow = async ({
  url,
  deleteFromServer,
  deleteCalendar,
}: DeleteFlowParams): Promise<void> => {
  if (deleteFromServer) {
    try {
      const settings = await getCalDAVSyncSettings();
      if (settings) {
        await deleteRemoteCalendar(
          {
            serverUrl: settings.serverUrl,
            username: settings.username,
            password: settings.password,
            settingId: settings.id,
          },
          url
        );
      }
    } catch (e) {
      console.error('서버 캘린더 삭제 실패:', e);
      alert(`서버 캘린더 삭제 중 오류가 발생했습니다.\n목록에서만 제거됩니다.\n${e instanceof Error ? e.message : String(e)}`);
    }
  }

  deleteCalendar(url);

  const normalizedUrl = normalizeCalendarUrl(url);
  if (normalizedUrl) {
    const { error } = await supabase.from('events').delete().eq('calendar_url', normalizedUrl);
    if (error) console.error('Failed to delete events for calendar', url, error);

    if (url.includes('holidays/kr_ko.ics')) {
      localStorage.removeItem('holiday_synced_v2');
    }
  }
};
