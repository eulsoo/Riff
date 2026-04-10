import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarMetadata } from './api';
import { deleteGoogleCalendarById, syncLocalCalendarToGoogle } from './calendarGoogleSyncFlow';

const mocked = vi.hoisted(() => {
  const getGoogleProviderToken = vi.fn();
  const fetchGoogleCalendarList = vi.fn();
  const createGoogleCalendar = vi.fn();
  const deleteGoogleCalendar = vi.fn();
  const uploadEventToGoogle = vi.fn();
  const fetchEvents = vi.fn();
  const updateEvent = vi.fn();
  return {
    getGoogleProviderToken,
    fetchGoogleCalendarList,
    createGoogleCalendar,
    deleteGoogleCalendar,
    uploadEventToGoogle,
    fetchEvents,
    updateEvent,
  };
});

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    fetchEvents: mocked.fetchEvents,
    updateEvent: mocked.updateEvent,
  };
});

vi.mock('../lib/googleCalendar', () => ({
  getGoogleProviderToken: mocked.getGoogleProviderToken,
  fetchGoogleCalendarList: mocked.fetchGoogleCalendarList,
  createGoogleCalendar: mocked.createGoogleCalendar,
  deleteGoogleCalendar: mocked.deleteGoogleCalendar,
  uploadEventToGoogle: mocked.uploadEventToGoogle,
}));

const makeCalendar = (overrides: Partial<CalendarMetadata> = {}): CalendarMetadata => ({
  url: 'local-123',
  displayName: '로컬',
  color: '#3b82f6',
  isLocal: true,
  ...overrides,
});

describe('calendarGoogleSyncFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.fetchEvents.mockResolvedValue([]);
    mocked.updateEvent.mockResolvedValue({});
    mocked.uploadEventToGoogle.mockResolvedValue('g-event-id');
  });

  it('Google 토큰이 없으면 needs-auth를 반환한다', async () => {
    mocked.getGoogleProviderToken.mockResolvedValue(null);
    const result = await syncLocalCalendarToGoogle(makeCalendar());
    expect(result.status).toBe('needs-auth');
  });

  it('Google 캘린더 생성 성공 시 createdFromApp 메타를 반환한다', async () => {
    mocked.getGoogleProviderToken.mockResolvedValue('token');
    mocked.fetchGoogleCalendarList.mockResolvedValue([]); // 동일 이름 없음 → 신규 생성
    mocked.createGoogleCalendar.mockResolvedValue({
      id: 'abc123',
      summary: '로컬',
      backgroundColor: '#10b981',
    });

    const result = await syncLocalCalendarToGoogle(makeCalendar({ displayName: '로컬', color: '#10b981' }));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.newCalendar.url).toBe('google:abc123');
      expect(result.newCalendar.type).toBe('google');
      expect(result.newCalendar.createdFromApp).toBe(true);
    }
  });

  it('동일 이름 캘린더가 Google에 있으면 재사용하고 신규 생성하지 않는다', async () => {
    mocked.getGoogleProviderToken.mockResolvedValue('token');
    mocked.fetchGoogleCalendarList.mockResolvedValue([
      { id: 'existing-id', summary: '무제구글', backgroundColor: '#3b82f6', foregroundColor: '#fff', accessRole: 'owner' },
    ]);
    const result = await syncLocalCalendarToGoogle(makeCalendar({ displayName: '무제구글' }));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.newCalendar.url).toBe('google:existing-id');
      expect(result.newCalendar.googleCalendarId).toBe('existing-id');
    }
    expect(mocked.createGoogleCalendar).not.toHaveBeenCalled();
  });

  it('동일 이름이 있어도 읽기전용이면 재사용하지 않고 새 캘린더를 생성한다', async () => {
    mocked.getGoogleProviderToken.mockResolvedValue('token');
    mocked.fetchGoogleCalendarList.mockResolvedValue([
      { id: 'readonly-id', summary: '회사 핵심업무', backgroundColor: '#a855f7', foregroundColor: '#fff', accessRole: 'reader' },
    ]);
    mocked.createGoogleCalendar.mockResolvedValue({
      id: 'new-id',
      summary: '회사 핵심업무',
      backgroundColor: '#f59e0b',
    });

    const result = await syncLocalCalendarToGoogle(makeCalendar({ displayName: '회사 핵심업무', color: '#f59e0b' }));
    expect(result.status).toBe('success');
    expect(mocked.createGoogleCalendar).toHaveBeenCalledTimes(1);
    if (result.status === 'success') {
      expect(result.newCalendar.url).toBe('google:new-id');
    }
  });

  it('Google API 401 오류면 needs-auth를 반환한다', async () => {
    mocked.getGoogleProviderToken.mockResolvedValue('token');
    mocked.fetchGoogleCalendarList.mockResolvedValue([]);
    const authError = Object.assign(new Error('createGoogleCalendar failed: 401 Unauthorized'), { code: 'AUTH' });
    mocked.createGoogleCalendar.mockRejectedValue(authError);

    const result = await syncLocalCalendarToGoogle(makeCalendar());
    expect(result.status).toBe('needs-auth');
  });

  it('기존 로컬 이벤트를 Google로 업로드하고 이벤트 링크를 갱신한다', async () => {
    mocked.getGoogleProviderToken.mockResolvedValue('token');
    mocked.fetchGoogleCalendarList.mockResolvedValue([]);
    mocked.createGoogleCalendar.mockResolvedValue({
      id: 'g-cal-1',
      summary: '회사 핵심업무',
      backgroundColor: '#a855f7',
    });
    mocked.fetchEvents.mockResolvedValue([
      {
        id: 'ev-1',
        title: '주간 업무',
        date: '2026-06-10',
        startTime: '09:00',
        endTime: '10:00',
        color: '#f59e0b',
        calendarUrl: 'local-123',
      },
      {
        id: 'ev-2',
        title: '다른 캘린더 이벤트',
        date: '2026-06-10',
        startTime: '11:00',
        endTime: '12:00',
        color: '#3b82f6',
        calendarUrl: 'local-other',
      },
    ]);
    mocked.uploadEventToGoogle.mockResolvedValue('g-ev-1');

    const result = await syncLocalCalendarToGoogle(
      makeCalendar({ url: 'local-123', displayName: '회사 핵심업무', color: '#f59e0b' })
    );

    expect(result.status).toBe('success');
    expect(mocked.uploadEventToGoogle).toHaveBeenCalledTimes(1);
    expect(mocked.uploadEventToGoogle).toHaveBeenCalledWith(
      'token',
      'g-cal-1',
      expect.objectContaining({ id: 'ev-1', calendarUrl: 'local-123' })
    );
    expect(mocked.updateEvent).toHaveBeenCalledWith('ev-1', {
      calendarUrl: 'google:g-cal-1',
      caldavUid: 'g-ev-1',
      source: 'google',
    });
    if (result.status === 'success') {
      expect(result.newCalendar.color).toBe('#f59e0b');
    }
  });

  it('로컬 이벤트가 있는데 모두 업로드 실패하면 error를 반환한다', async () => {
    mocked.getGoogleProviderToken.mockResolvedValue('token');
    mocked.fetchGoogleCalendarList.mockResolvedValue([]);
    mocked.createGoogleCalendar.mockResolvedValue({
      id: 'g-cal-1',
      summary: '회사 핵심업무',
      backgroundColor: '#f59e0b',
    });
    mocked.fetchEvents.mockResolvedValue([
      {
        id: 'ev-1',
        title: '주간 업무',
        date: '2026-06-10',
        startTime: '09:00',
        endTime: '10:00',
        color: '#f59e0b',
        calendarUrl: 'local-123',
      },
    ]);
    mocked.uploadEventToGoogle.mockResolvedValue(null);

    const result = await syncLocalCalendarToGoogle(
      makeCalendar({ url: 'local-123', displayName: '회사 핵심업무', color: '#f59e0b' })
    );

    expect(result.status).toBe('error');
    expect(mocked.updateEvent).not.toHaveBeenCalled();
  });

  it('Google 원격 삭제 시 토큰과 calendarId를 사용한다', async () => {
    mocked.getGoogleProviderToken.mockResolvedValue('token');
    mocked.deleteGoogleCalendar.mockResolvedValue(undefined);

    await deleteGoogleCalendarById('abc123');
    expect(mocked.deleteGoogleCalendar).toHaveBeenCalledWith('token', 'abc123');
  });
});
