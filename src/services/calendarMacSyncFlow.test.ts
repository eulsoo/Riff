import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarMetadata } from './api';
import { syncCalendarNameToRemote, syncLocalCalendarToMac } from './calendarMacSyncFlow';

const mocked = vi.hoisted(() => {
  const getCalDAVSyncSettings = vi.fn();
  const createRemoteCalendar = vi.fn();
  const renameRemoteCalendar = vi.fn();
  return {
    getCalDAVSyncSettings,
    createRemoteCalendar,
    renameRemoteCalendar,
  };
});

vi.mock('./api', () => ({
  getCalDAVSyncSettings: mocked.getCalDAVSyncSettings,
}));

vi.mock('./caldav', () => ({
  createRemoteCalendar: mocked.createRemoteCalendar,
  renameRemoteCalendar: mocked.renameRemoteCalendar,
}));

const makeCalendar = (overrides: Partial<CalendarMetadata> = {}): CalendarMetadata => ({
  url: 'local-123',
  displayName: 'Local',
  color: '#3b82f6',
  isLocal: true,
  ...overrides,
});

describe('calendarMacSyncFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CalDAV 설정이 없으면 needs-auth를 반환한다', async () => {
    mocked.getCalDAVSyncSettings.mockResolvedValue(null);
    const result = await syncLocalCalendarToMac(makeCalendar());
    expect(result.status).toBe('needs-auth');
  });

  it('원격 생성 성공 시 success와 새 캘린더 메타를 반환한다', async () => {
    mocked.getCalDAVSyncSettings.mockResolvedValue({
      serverUrl: 'https://caldav.icloud.com',
      username: 'user@icloud.com',
      password: 'pw',
      id: 'setting-id',
    });
    mocked.createRemoteCalendar.mockResolvedValue({
      success: true,
      calendarUrl: 'https://caldav.icloud.com/user/calendars/new',
      displayName: 'New',
      color: '#10b981',
    });

    const result = await syncLocalCalendarToMac(makeCalendar({ displayName: 'New', color: '#10b981' }));

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.remoteCalendarUrl).toBe('https://caldav.icloud.com/user/calendars/new');
      expect(result.newCalendar.type).toBe('caldav');
      expect(result.newCalendar.createdFromApp).toBe(true);
    }
  });

  it('원격 생성 중 예외 발생 시 error를 반환한다', async () => {
    mocked.getCalDAVSyncSettings.mockResolvedValue({
      serverUrl: 'https://caldav.icloud.com',
      username: 'user@icloud.com',
    });
    mocked.createRemoteCalendar.mockRejectedValue(new Error('network error'));

    const result = await syncLocalCalendarToMac(makeCalendar());
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('network error');
    }
  });

  it('원격 rename은 CalDAV로 동기화된 캘린더에서만 실행한다', async () => {
    mocked.getCalDAVSyncSettings.mockResolvedValue({
      serverUrl: 'https://caldav.icloud.com',
      username: 'user@icloud.com',
      password: 'pw',
      id: 'setting-id',
    });

    const metadata: CalendarMetadata[] = [
      makeCalendar({
        url: 'https://caldav.icloud.com/user/calendars/work',
        isLocal: false,
        createdFromApp: true,
      }),
    ];

    await syncCalendarNameToRemote(
      'https://caldav.icloud.com/user/calendars/work',
      'Renamed Work',
      metadata
    );

    expect(mocked.renameRemoteCalendar).toHaveBeenCalled();
  });
});
