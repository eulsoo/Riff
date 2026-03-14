import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconnectCalDAV } from './calendarReconnectFlow';

const mocked = vi.hoisted(() => {
  const getCalDAVSyncSettings = vi.fn();
  const getCalendars = vi.fn();
  return { getCalDAVSyncSettings, getCalendars };
});

vi.mock('./api', () => ({
  getCalDAVSyncSettings: mocked.getCalDAVSyncSettings,
}));

vi.mock('./caldav', () => ({
  getCalendars: mocked.getCalendars,
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

describe('reconnectCalDAV', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it('저장된 설정 없으면 needs-auth 반환', async () => {
    mocked.getCalDAVSyncSettings.mockResolvedValue(null);
    const result = await reconnectCalDAV();
    expect(result).toBe('needs-auth');
    expect(mocked.getCalendars).not.toHaveBeenCalled();
  });

  it('password 없는 설정이면 needs-auth 반환', async () => {
    mocked.getCalDAVSyncSettings.mockResolvedValue({
      serverUrl: 'https://caldav.icloud.com',
      username: 'user@icloud.com',
      password: undefined,
      id: 'id-1',
    });
    const result = await reconnectCalDAV();
    expect(result).toBe('needs-auth');
    expect(mocked.getCalendars).not.toHaveBeenCalled();
  });

  it('연결 성공 시 caldavAuthError localStorage 제거 후 success 반환', async () => {
    localStorage.setItem('caldavAuthError', 'true');
    mocked.getCalDAVSyncSettings.mockResolvedValue({
      serverUrl: 'https://caldav.icloud.com',
      username: 'user@icloud.com',
      password: 'app-password',
      id: 'id-1',
    });
    mocked.getCalendars.mockResolvedValue([]);

    const result = await reconnectCalDAV();

    expect(result).toBe('success');
    expect(localStorage.getItem('caldavAuthError')).toBeNull();
    expect(mocked.getCalendars).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'https://caldav.icloud.com', username: 'user@icloud.com' })
    );
  });

  it('연결 실패(에러 throw) 시 error 반환, localStorage는 변경 없음', async () => {
    localStorage.setItem('caldavAuthError', 'true');
    mocked.getCalDAVSyncSettings.mockResolvedValue({
      serverUrl: 'https://caldav.icloud.com',
      username: 'user@icloud.com',
      password: 'wrong-password',
      id: 'id-1',
    });
    mocked.getCalendars.mockRejectedValue(new Error('401 Unauthorized'));

    const result = await reconnectCalDAV();

    expect(result).toBe('error');
    expect(localStorage.getItem('caldavAuthError')).toBe('true');
  });
});
