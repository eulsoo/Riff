import { supabase } from '../lib/supabase';
import { CalendarMetadata, getCalDAVSyncSettings, normalizeCalendarUrl, deleteEventsByCalendarUrl, updateCalDAVSelectedCalendars } from './api';
import { clearCalDAVSyncTokenForCalendar, deleteRemoteCalendar } from './caldav';
import { isCalDAVSyncTarget } from './calendarSyncUtils';
import { relinkEventsByCalendarUrl } from './calendarEventRelink';

export interface CalendarDeleteState {
  isOpen: boolean;
  url: string;
  name: string;
  isCalDAV: boolean;
  isUnsync?: boolean;
  isGoogle?: boolean;
  isCreatedFromApp?: boolean;
}

export const buildCalendarDeleteState = (
  url: string,
  actionType: 'unsync' | 'delete' | undefined,
  calendarMetadata: CalendarMetadata[],
  googleCalendars: CalendarMetadata[]
): CalendarDeleteState | null => {
  if (url.startsWith('google:')) {
    const cal = googleCalendars.find(c => c.url === url) ?? calendarMetadata.find(c => c.url === url);
    const name = cal?.displayName || '캘린더';
    if (actionType === 'unsync') {
      return {
        isOpen: true,
        url,
        name,
        isCalDAV: false,
        isUnsync: true,
        isGoogle: true,
        isCreatedFromApp: !!cal?.createdFromApp,
      };
    }
    if (actionType === 'delete') {
      return {
        isOpen: true,
        url,
        name,
        isCalDAV: false,
        isUnsync: false,
        isGoogle: true,
      };
    }
    return null;
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
      isCreatedFromApp: !!calendar.createdFromApp,
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
  isCreatedFromApp?: boolean;
  markUnsyncedUrl: (url: string) => void;
  removeGoogleCalendar: (calendarId: string) => void;
  deleteCalendar: (url: string) => void;
  convertCalDAVToLocal?: (oldUrl: string) => string;
  convertGoogleToLocal?: (oldUrl: string) => string;
  deleteGoogleCalendarById?: (calendarId: string) => Promise<void>;
  loadData: (force?: boolean, excludeCalendarUrls?: string[]) => Promise<void>;
  setToast: (toast: { message: string; type: 'loading' | 'success' | 'error' } | null) => void;
}

export const runCalendarUnsyncFlow = async ({
  url,
  isGoogle,
  isCreatedFromApp,
  markUnsyncedUrl,
  removeGoogleCalendar,
  deleteCalendar,
  convertCalDAVToLocal,
  convertGoogleToLocal,
  deleteGoogleCalendarById,
  loadData,
  setToast,
}: UnsyncFlowParams): Promise<void> => {
  markUnsyncedUrl(url);
  markUnsyncedUrl(normalizeCalendarUrl(url) || url);

  if (isGoogle) {
    // Riff에서 만들어 Google로 내보낸 캘린더: Riff 보존 + Google 삭제
    if (isCreatedFromApp && convertGoogleToLocal && deleteGoogleCalendarById) {
      const newLocalUrl = convertGoogleToLocal(url);
      try {
        await relinkEventsByCalendarUrl(new Map([[url, newLocalUrl]]), '[Unsync-Google]');
        const calendarId = url.replace('google:', '');
        await deleteGoogleCalendarById(calendarId);
        await loadData(true, [url]);
        setToast({ message: '동기화가 해제되었습니다. Riff 캘린더는 보존됩니다.', type: 'success' });
      } catch (e) {
        console.error('Google unsync cleanup error:', e);
        setToast({ message: '동기화 해제 중 오류가 발생했습니다.', type: 'error' });
      }
      return;
    }
    // Google에서 가져온 캘린더: Riff에서 제거, Google은 유지
    const id = url.replace('google:', '');
    removeGoogleCalendar(id);
    try {
      await deleteEventsByCalendarUrl(url);
      await loadData(true, [url]);
      setToast({ message: '동기화가 해제되었습니다.', type: 'success' });
    } catch (e) {
      console.error('Google unsync cleanup error:', e);
      setToast({ message: '동기화 해제 중 오류가 발생했습니다.', type: 'error' });
    }
    return;
  }

  // Riff에서 만들어 iCloud로 내보낸 캘린더: Riff 보존 + iCloud 삭제
  if (isCreatedFromApp && convertCalDAVToLocal) {
    const newLocalUrl = convertCalDAVToLocal(url);
    try {
      const norm = normalizeCalendarUrl(url);
      const urlMap = new Map([[url, newLocalUrl]]);
      if (norm && norm !== url) urlMap.set(norm, newLocalUrl);
      await relinkEventsByCalendarUrl(urlMap, '[Unsync]');

      const settings = await getCalDAVSyncSettings();
      if (settings) {
        await deleteRemoteCalendar(
          { serverUrl: settings.serverUrl, username: settings.username, password: settings.password, settingId: settings.id },
          url
        );
        clearCalDAVSyncTokenForCalendar(
          { serverUrl: settings.serverUrl, username: settings.username, password: settings.password, settingId: settings.id },
          url
        );
        if (settings.selectedCalendarUrls?.length) {
          const filtered = settings.selectedCalendarUrls.filter(
            u => normalizeCalendarUrl(u) !== norm && u !== url
          );
          if (filtered.length !== settings.selectedCalendarUrls.length) {
            await updateCalDAVSelectedCalendars(filtered);
          }
        }
      }
      await loadData(true, [url, norm || url]);
      setToast({ message: '동기화가 해제되었습니다. Riff 캘린더는 보존됩니다.', type: 'success' });
    } catch (e) {
      console.error('Unsync cleanup error:', e);
      setToast({ message: '동기화 해제 중 오류가 발생했습니다.', type: 'error' });
    }
    return;
  }

  // iCloud에서 가져온 캘린더: Riff에서 제거, iCloud는 유지
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

export interface DeleteFlowResult {
  /** 서버 삭제에 실패했을 때 true. 호출자가 로컬 삭제 여부를 확인 후 localDelete()를 호출해야 함. */
  serverDeleteFailed?: boolean;
  /** 실패 시 Riff 로컬에서만 삭제하는 함수. serverDeleteFailed=true일 때만 존재. */
  localDelete?: () => Promise<void>;
}

interface DeleteFlowParams {
  url: string;
  deleteFromServer: boolean;
  deleteCalendar: (url: string) => void;
  isGoogle?: boolean;
  deleteGoogleCalendarById?: (calendarId: string) => Promise<void>;
}

const runLocalDelete = async (
  url: string,
  deleteCalendar: (url: string) => void,
): Promise<void> => {
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

export const runCalendarDeleteFlow = async ({
  url,
  deleteFromServer,
  deleteCalendar,
  isGoogle,
  deleteGoogleCalendarById,
}: DeleteFlowParams): Promise<DeleteFlowResult> => {
  if (isGoogle) {
    if (deleteFromServer && deleteGoogleCalendarById) {
      const calendarId = url.replace('google:', '');
      try {
        await deleteGoogleCalendarById(calendarId);
      } catch (e) {
        console.error('Google 캘린더 원격 삭제 실패:', e);
        return {
          serverDeleteFailed: true,
          localDelete: async () => {
            deleteCalendar(url);
            await deleteEventsByCalendarUrl(url);
          },
        };
      }
    }

    deleteCalendar(url);
    await deleteEventsByCalendarUrl(url);
    return {};
  }

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
      return {
        serverDeleteFailed: true,
        localDelete: () => runLocalDelete(url, deleteCalendar),
      };
    }
  }

  await runLocalDelete(url, deleteCalendar);
  return {};
};
