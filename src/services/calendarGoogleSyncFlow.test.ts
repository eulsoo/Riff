import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarMetadata } from './api';
import { deleteGoogleCalendarById, syncLocalCalendarToGoogle } from './calendarGoogleSyncFlow';

const mocked = vi.hoisted(() => {
  const getGoogleProviderToken = vi.fn();
  const fetchGoogleCalendarList = vi.fn();
  const createGoogleCalendar = vi.fn();
  const deleteGoogleCalendar = vi.fn();
  return {
    getGoogleProviderToken,
    fetchGoogleCalendarList,
    createGoogleCalendar,
    deleteGoogleCalendar,
  };
});

vi.mock('../lib/googleCalendar', () => ({
  getGoogleProviderToken: mocked.getGoogleProviderToken,
  fetchGoogleCalendarList: mocked.fetchGoogleCalendarList,
  createGoogleCalendar: mocked.createGoogleCalendar,
  deleteGoogleCalendar: mocked.deleteGoogleCalendar,
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

  it('Google API 401 오류면 needs-auth를 반환한다', async () => {
    mocked.getGoogleProviderToken.mockResolvedValue('token');
    mocked.fetchGoogleCalendarList.mockResolvedValue([]);
    const authError = Object.assign(new Error('createGoogleCalendar failed: 401 Unauthorized'), { code: 'AUTH' });
    mocked.createGoogleCalendar.mockRejectedValue(authError);

    const result = await syncLocalCalendarToGoogle(makeCalendar());
    expect(result.status).toBe('needs-auth');
  });

  it('Google 원격 삭제 시 토큰과 calendarId를 사용한다', async () => {
    mocked.getGoogleProviderToken.mockResolvedValue('token');
    mocked.deleteGoogleCalendar.mockResolvedValue(undefined);

    await deleteGoogleCalendarById('abc123');
    expect(mocked.deleteGoogleCalendar).toHaveBeenCalledWith('token', 'abc123');
  });
});
