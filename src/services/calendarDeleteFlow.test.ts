import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarMetadata } from './api';
import {
  buildCalendarDeleteState,
  runCalendarUnsyncFlow,
  runCalendarDeleteFlow,
} from './calendarDeleteFlow';

const mocked = vi.hoisted(() => {
  const getCalDAVSyncSettings = vi.fn();
  const deleteEventsByCalendarUrl = vi.fn();
  const updateCalDAVSelectedCalendars = vi.fn();
  const clearCalDAVSyncTokenForCalendar = vi.fn();
  const deleteRemoteCalendar = vi.fn();

  const eq = vi.fn().mockResolvedValue({ error: null });
  const del = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ delete: del }));

  return {
    getCalDAVSyncSettings,
    deleteEventsByCalendarUrl,
    updateCalDAVSelectedCalendars,
    clearCalDAVSyncTokenForCalendar,
    deleteRemoteCalendar,
    eq,
    del,
    from,
  };
});

vi.mock('./api', () => ({
  getCalDAVSyncSettings: mocked.getCalDAVSyncSettings,
  normalizeCalendarUrl: (url?: string | null) => (url ? url.replace(/\/+$/, '') : url),
  deleteEventsByCalendarUrl: mocked.deleteEventsByCalendarUrl,
  updateCalDAVSelectedCalendars: mocked.updateCalDAVSelectedCalendars,
}));

vi.mock('./caldav', () => ({
  clearCalDAVSyncTokenForCalendar: mocked.clearCalDAVSyncTokenForCalendar,
  deleteRemoteCalendar: mocked.deleteRemoteCalendar,
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: mocked.from,
  },
}));

const makeCalendar = (overrides: Partial<CalendarMetadata> = {}): CalendarMetadata => ({
  url: 'https://caldav.icloud.com/user/calendars/work',
  displayName: 'Work',
  color: '#3b82f6',
  ...overrides,
});

describe('calendarDeleteFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Google 캘린더는 unsync/delete 상태를 모두 생성한다', () => {
    const google = makeCalendar({ url: 'google:primary', displayName: 'Google Primary' });
    const unsyncState = buildCalendarDeleteState('google:primary', 'unsync', [], [google]);
    const deleteState = buildCalendarDeleteState('google:primary', 'delete', [], [google]);

    expect(unsyncState?.isUnsync).toBe(true);
    expect(unsyncState?.isGoogle).toBe(true);
    expect(deleteState?.isGoogle).toBe(true);
    expect(deleteState?.isUnsync).toBe(false);
  });

  it('CalDAV unsync 시 token/이벤트/선택 캘린더를 정리한다', async () => {
    mocked.getCalDAVSyncSettings.mockResolvedValue({
      serverUrl: 'https://caldav.icloud.com',
      username: 'user@icloud.com',
      password: 'pw',
      id: 'setting-id',
      selectedCalendarUrls: [
        'https://caldav.icloud.com/user/calendars/work/',
        'https://caldav.icloud.com/user/calendars/home',
      ],
    });

    const markUnsyncedUrl = vi.fn();
    const removeGoogleCalendar = vi.fn();
    const deleteCalendar = vi.fn();
    const loadData = vi.fn().mockResolvedValue(undefined);
    const setToast = vi.fn();

    await runCalendarUnsyncFlow({
      url: 'https://caldav.icloud.com/user/calendars/work',
      isGoogle: false,
      markUnsyncedUrl,
      removeGoogleCalendar,
      deleteCalendar,
      loadData,
      setToast,
    });

    expect(markUnsyncedUrl).toHaveBeenCalledTimes(2);
    expect(deleteCalendar).toHaveBeenCalledWith('https://caldav.icloud.com/user/calendars/work');
    expect(mocked.clearCalDAVSyncTokenForCalendar).toHaveBeenCalled();
    expect(mocked.deleteEventsByCalendarUrl).toHaveBeenCalledWith('https://caldav.icloud.com/user/calendars/work');
    expect(mocked.updateCalDAVSelectedCalendars).toHaveBeenCalledWith([
      'https://caldav.icloud.com/user/calendars/home',
    ]);
    expect(loadData).toHaveBeenCalledWith(true, [
      'https://caldav.icloud.com/user/calendars/work',
      'https://caldav.icloud.com/user/calendars/work',
    ]);
    expect(setToast).toHaveBeenCalledWith({ message: '동기화가 해제되었습니다.', type: 'success' });
    expect(removeGoogleCalendar).not.toHaveBeenCalled();
  });

  it('원격 삭제 옵션일 때 서버 삭제 후 로컬 이벤트 정리를 수행한다', async () => {
    mocked.getCalDAVSyncSettings.mockResolvedValue({
      serverUrl: 'https://caldav.icloud.com',
      username: 'user@icloud.com',
      password: 'pw',
      id: 'setting-id',
    });
    const deleteCalendar = vi.fn();

    await runCalendarDeleteFlow({
      url: 'https://caldav.icloud.com/user/calendars/work',
      deleteFromServer: true,
      deleteCalendar,
    });

    expect(mocked.deleteRemoteCalendar).toHaveBeenCalled();
    expect(deleteCalendar).toHaveBeenCalledWith('https://caldav.icloud.com/user/calendars/work');
    expect(mocked.from).toHaveBeenCalledWith('events');
    expect(mocked.del).toHaveBeenCalled();
    expect(mocked.eq).toHaveBeenCalledWith('calendar_url', 'https://caldav.icloud.com/user/calendars/work');
  });

  it('Google 원격 삭제 옵션일 때 Google API 삭제 후 로컬 정리를 수행한다', async () => {
    const deleteCalendar = vi.fn();
    const deleteGoogleCalendarById = vi.fn().mockResolvedValue(undefined);

    await runCalendarDeleteFlow({
      url: 'google:my-calendar-id',
      deleteFromServer: true,
      deleteCalendar,
      isGoogle: true,
      deleteGoogleCalendarById,
    });

    expect(deleteGoogleCalendarById).toHaveBeenCalledWith('my-calendar-id');
    expect(deleteCalendar).toHaveBeenCalledWith('google:my-calendar-id');
    expect(mocked.deleteEventsByCalendarUrl).toHaveBeenCalledWith('google:my-calendar-id');
  });
});
