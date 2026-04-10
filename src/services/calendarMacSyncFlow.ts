import { CalendarMetadata, getCalDAVSyncSettings, fetchEvents, updateEventUID } from './api';
import { createRemoteCalendar, renameRemoteCalendar, createCalDavEvent, CalDAVConfig } from './caldav';

const buildCalDAVConfig = (settings: {
  serverUrl: string;
  username: string;
  password?: string;
  id?: string | null;
}): CalDAVConfig => ({
  serverUrl: settings.serverUrl,
  username: settings.username,
  password: settings.password,
  settingId: settings.id || undefined,
});

export type SyncLocalCalendarToMacResult =
  | { status: 'needs-auth' }
  | {
      status: 'success';
      newCalendar: CalendarMetadata;
      remoteCalendarUrl: string;
    }
  | {
      status: 'error';
      message: string;
    };

export const syncLocalCalendarToMac = async (
  calendar: CalendarMetadata
): Promise<SyncLocalCalendarToMacResult> => {
  try {
    const savedSettings = await getCalDAVSyncSettings();
    if (!savedSettings?.serverUrl || !savedSettings?.username) {
      return { status: 'needs-auth' };
    }

    const config = buildCalDAVConfig(savedSettings);
    const result = await createRemoteCalendar(config, calendar.displayName, calendar.color);
    if (!result.success) {
      return { status: 'error', message: '원격 캘린더 생성에 실패했습니다.' };
    }

    // 기존 로컬 이벤트를 CalDAV 서버에 업로드하고 DB의 caldav_uid + calendar_url 갱신
    const existingEvents = await fetchEvents();
    const calEvents = existingEvents.filter(e => e.calendarUrl === calendar.url);
    for (const event of calEvents) {
      try {
        const { success, uid } = await createCalDavEvent(config, result.calendarUrl, event);
        if (success) {
          await updateEventUID(event.id, uid, result.calendarUrl);
        }
      } catch (e) {
        console.warn('[Mac Sync] 이벤트 업로드 실패:', event.title, e);
      }
    }

    return {
      status: 'success',
      remoteCalendarUrl: result.calendarUrl,
      newCalendar: {
        url: result.calendarUrl,
        displayName: result.displayName,
        color: result.color,
        isVisible: true,
        isLocal: false,
        type: 'caldav',
        createdFromApp: true,
      },
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

export const syncCalendarNameToRemote = async (
  url: string,
  newName: string,
  calendarMetadata: CalendarMetadata[]
): Promise<void> => {
  const cal = calendarMetadata.find(c => c.url === url);
  const isCalDAVSynced = cal && cal.createdFromApp && !cal.isLocal && cal.url.startsWith('http');
  if (!isCalDAVSynced) return;

  try {
    const settings = await getCalDAVSyncSettings();
    if (!settings) return;

    const config = buildCalDAVConfig(settings);
    await renameRemoteCalendar(config, url, newName);
  } catch (e) {
    console.warn('[Rename] 서버 이름 변경 실패 (로컬에는 저장됨):', e);
  }
};
