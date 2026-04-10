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
  const relinkEventsByCalendarUrl = vi.fn().mockResolvedValue(undefined);

  const eq = vi.fn().mockResolvedValue({ error: null });
  const del = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ delete: del }));

  return {
    getCalDAVSyncSettings,
    deleteEventsByCalendarUrl,
    updateCalDAVSelectedCalendars,
    clearCalDAVSyncTokenForCalendar,
    deleteRemoteCalendar,
    relinkEventsByCalendarUrl,
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

vi.mock('./calendarEventRelink', () => ({
  relinkEventsByCalendarUrl: mocked.relinkEventsByCalendarUrl,
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

  // ── createdFromApp 플래그 전파 ──

  it('createdFromApp Google 캘린더는 isCreatedFromApp=true를 포함한 unsync 상태를 생성한다', () => {
    const googleCreated = makeCalendar({ url: 'google:cal-xyz', displayName: 'Riff→Google', createdFromApp: true });
    const state = buildCalendarDeleteState('google:cal-xyz', 'unsync', [], [googleCreated]);
    expect(state?.isCreatedFromApp).toBe(true);
    expect(state?.isGoogle).toBe(true);
    expect(state?.isUnsync).toBe(true);
  });

  it('createdFromApp CalDAV 캘린더는 isCreatedFromApp=true를 포함한 unsync 상태를 생성한다', () => {
    const caldavCreated = makeCalendar({ url: 'https://caldav.icloud.com/user/cal', createdFromApp: true });
    const state = buildCalendarDeleteState('https://caldav.icloud.com/user/cal', 'unsync', [caldavCreated], []);
    expect(state?.isCreatedFromApp).toBe(true);
    expect(state?.isCalDAV).toBe(true);
    expect(state?.isUnsync).toBe(true);
  });

  // ── 시나리오 I: Google createdFromApp unsync ──

  it('Google createdFromApp unsync: relinkEvents 후 Google 캘린더를 삭제하고 Riff 이벤트를 보존한다', async () => {
    const markUnsyncedUrl = vi.fn();
    const removeGoogleCalendar = vi.fn();
    const deleteCalendar = vi.fn();
    const convertGoogleToLocal = vi.fn().mockReturnValue('local-unsynced-123');
    const deleteGoogleCalendarById = vi.fn().mockResolvedValue(undefined);
    const loadData = vi.fn().mockResolvedValue(undefined);
    const setToast = vi.fn();

    await runCalendarUnsyncFlow({
      url: 'google:my-cal-id',
      isGoogle: true,
      isCreatedFromApp: true,
      markUnsyncedUrl,
      removeGoogleCalendar,
      deleteCalendar,
      convertGoogleToLocal,
      deleteGoogleCalendarById,
      loadData,
      setToast,
    });

    expect(mocked.relinkEventsByCalendarUrl).toHaveBeenCalledWith(
      new Map([['google:my-cal-id', 'local-unsynced-123']]),
      '[Unsync-Google]'
    );
    expect(deleteGoogleCalendarById).toHaveBeenCalledWith('my-cal-id');
    expect(deleteCalendar).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Riff 캘린더는 보존됩니다'), type: 'success' })
    );
  });

  it('Google createdFromApp unsync: 원래 local URL 이력이 있으면 함께 relink한다', async () => {
    const markUnsyncedUrl = vi.fn();
    const removeGoogleCalendar = vi.fn();
    const deleteCalendar = vi.fn();
    const convertGoogleToLocal = vi.fn().mockReturnValue('local-unsynced-123');
    const getOriginalLocalUrlForGoogle = vi.fn().mockReturnValue('local-legacy-1');
    const deleteGoogleCalendarById = vi.fn().mockResolvedValue(undefined);
    const loadData = vi.fn().mockResolvedValue(undefined);
    const setToast = vi.fn();

    await runCalendarUnsyncFlow({
      url: 'google:my-cal-id',
      isGoogle: true,
      isCreatedFromApp: true,
      markUnsyncedUrl,
      removeGoogleCalendar,
      deleteCalendar,
      convertGoogleToLocal,
      getOriginalLocalUrlForGoogle,
      deleteGoogleCalendarById,
      loadData,
      setToast,
    });

    expect(mocked.relinkEventsByCalendarUrl).toHaveBeenCalledWith(
      new Map([
        ['google:my-cal-id', 'local-unsynced-123'],
        ['local-legacy-1', 'local-unsynced-123'],
      ]),
      '[Unsync-Google]'
    );
  });

  // ── 시나리오 E: CalDAV createdFromApp unsync ──

  it('CalDAV createdFromApp unsync: relinkEvents 후 iCloud 캘린더를 삭제하고 Riff 이벤트를 보존한다', async () => {
    mocked.getCalDAVSyncSettings.mockResolvedValue({
      serverUrl: 'https://caldav.icloud.com',
      username: 'user@icloud.com',
      password: 'pw',
      id: 'setting-id',
      selectedCalendarUrls: ['https://caldav.icloud.com/user/calendars/work/'],
    });

    const markUnsyncedUrl = vi.fn();
    const removeGoogleCalendar = vi.fn();
    const deleteCalendar = vi.fn();
    const convertCalDAVToLocal = vi.fn().mockReturnValue('local-unsynced-456');
    const loadData = vi.fn().mockResolvedValue(undefined);
    const setToast = vi.fn();

    await runCalendarUnsyncFlow({
      url: 'https://caldav.icloud.com/user/calendars/work',
      isGoogle: false,
      isCreatedFromApp: true,
      markUnsyncedUrl,
      removeGoogleCalendar,
      deleteCalendar,
      convertCalDAVToLocal,
      loadData,
      setToast,
    });

    expect(mocked.relinkEventsByCalendarUrl).toHaveBeenCalled();
    expect(mocked.deleteRemoteCalendar).toHaveBeenCalled();
    expect(mocked.clearCalDAVSyncTokenForCalendar).toHaveBeenCalled();
    expect(deleteCalendar).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Riff 캘린더는 보존됩니다'), type: 'success' })
    );
  });

  // ── Google 일반 unsync ──

  it('Google 일반 unsync: removeGoogleCalendar와 이벤트 정리를 수행한다', async () => {
    const markUnsyncedUrl = vi.fn();
    const removeGoogleCalendar = vi.fn();
    const deleteCalendar = vi.fn();
    const loadData = vi.fn().mockResolvedValue(undefined);
    const setToast = vi.fn();

    await runCalendarUnsyncFlow({
      url: 'google:ext-cal-id',
      isGoogle: true,
      isCreatedFromApp: false,
      markUnsyncedUrl,
      removeGoogleCalendar,
      deleteCalendar,
      loadData,
      setToast,
    });

    expect(removeGoogleCalendar).toHaveBeenCalledWith('ext-cal-id');
    expect(mocked.deleteEventsByCalendarUrl).toHaveBeenCalledWith('google:ext-cal-id');
    expect(deleteCalendar).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith({ message: '동기화가 해제되었습니다.', type: 'success' });
  });
});
