import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGoogleExternalDelete, handleCalDAVExternalDelete } from './calendarExternalDeleteFlow';

const mocked = vi.hoisted(() => ({
  convertGoogleToLocal: vi.fn().mockReturnValue('local-unsynced-123'),
  relinkEventsByCalendarUrl: vi.fn().mockResolvedValue(undefined),
  removeGoogleCalendar: vi.fn(),
  deleteEventsByCalendarUrl: vi.fn().mockResolvedValue(undefined),
}));

describe('handleGoogleExternalDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.convertGoogleToLocal.mockReturnValue('local-unsynced-123');
  });

  it('Google→Riff 외부 삭제: 이벤트 삭제 후 토스트 반환', async () => {
    const result = await handleGoogleExternalDelete('cal-123', false, {
      calendarName: '업무',
      convertGoogleToLocal: mocked.convertGoogleToLocal,
      relinkEventsByCalendarUrl: mocked.relinkEventsByCalendarUrl,
      removeGoogleCalendar: mocked.removeGoogleCalendar,
      deleteEventsByCalendarUrl: mocked.deleteEventsByCalendarUrl,
    });

    expect(mocked.removeGoogleCalendar).toHaveBeenCalledWith('cal-123');
    expect(mocked.deleteEventsByCalendarUrl).toHaveBeenCalledWith('google:cal-123');
    expect(mocked.convertGoogleToLocal).not.toHaveBeenCalled();
    expect(mocked.relinkEventsByCalendarUrl).not.toHaveBeenCalled();
    expect(result.message).toContain('제거');
    expect(result.type).toBe('info');
  });

  it('Riff→Google 외부 삭제: 로컬 전환 + 이벤트 re-link 후 토스트 반환', async () => {
    const result = await handleGoogleExternalDelete('cal-123', true, {
      calendarName: '개인',
      convertGoogleToLocal: mocked.convertGoogleToLocal,
      relinkEventsByCalendarUrl: mocked.relinkEventsByCalendarUrl,
      removeGoogleCalendar: mocked.removeGoogleCalendar,
      deleteEventsByCalendarUrl: mocked.deleteEventsByCalendarUrl,
    });

    expect(mocked.convertGoogleToLocal).toHaveBeenCalledWith('google:cal-123');
    expect(mocked.relinkEventsByCalendarUrl).toHaveBeenCalledWith(
      new Map([['google:cal-123', 'local-unsynced-123']]),
      '[ExternalDelete-Google-CreatedFromApp]'
    );
    expect(mocked.removeGoogleCalendar).not.toHaveBeenCalled();
    expect(mocked.deleteEventsByCalendarUrl).not.toHaveBeenCalled();
    expect(result.message).toContain('전환');
    expect(result.type).toBe('info');
  });
});

describe('handleCalDAVExternalDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('iCloud→Riff 외부 삭제: 이벤트 삭제 후 토스트 반환', async () => {
    const url = 'https://caldav.icloud.com/123/calendars/work/';
    const result = await handleCalDAVExternalDelete(url, false, {
      calendarName: '업무',
      relinkEventsByCalendarUrl: mocked.relinkEventsByCalendarUrl,
      deleteEventsByCalendarUrl: mocked.deleteEventsByCalendarUrl,
    });

    expect(mocked.deleteEventsByCalendarUrl).toHaveBeenCalledWith(url);
    expect(mocked.relinkEventsByCalendarUrl).not.toHaveBeenCalled();
    expect(result.message).toContain('제거');
    expect(result.type).toBe('info');
  });

  it('Riff→iCloud 외부 삭제: 이벤트 re-link 후 토스트 반환', async () => {
    const url = 'https://caldav.icloud.com/123/calendars/riff-personal/';
    const newLocalUrl = 'local-restored-999';
    const result = await handleCalDAVExternalDelete(url, true, {
      calendarName: '개인',
      newLocalUrl,
      relinkEventsByCalendarUrl: mocked.relinkEventsByCalendarUrl,
      deleteEventsByCalendarUrl: mocked.deleteEventsByCalendarUrl,
    });

    expect(mocked.relinkEventsByCalendarUrl).toHaveBeenCalledWith(
      new Map([[url, newLocalUrl]]),
      '[ExternalDelete-CalDAV-CreatedFromApp]'
    );
    expect(mocked.deleteEventsByCalendarUrl).not.toHaveBeenCalled();
    expect(result.message).toContain('전환');
    expect(result.type).toBe('info');
  });

  it('Riff→iCloud 외부 삭제: newLocalUrl 없으면 이벤트 삭제 fallback', async () => {
    const url = 'https://caldav.icloud.com/123/calendars/riff-personal/';
    const result = await handleCalDAVExternalDelete(url, true, {
      calendarName: '개인',
      // newLocalUrl 없음
      relinkEventsByCalendarUrl: mocked.relinkEventsByCalendarUrl,
      deleteEventsByCalendarUrl: mocked.deleteEventsByCalendarUrl,
    });

    expect(mocked.deleteEventsByCalendarUrl).toHaveBeenCalledWith(url);
    expect(mocked.relinkEventsByCalendarUrl).not.toHaveBeenCalled();
    expect(result.message).toContain('제거');
  });
});
