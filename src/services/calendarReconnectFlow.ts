import { getCalDAVSyncSettings } from './api';
import { getCalendars } from './caldav';

export type ReconnectResult = 'success' | 'needs-auth' | 'error';

export const reconnectCalDAV = async (): Promise<ReconnectResult> => {
  const settings = await getCalDAVSyncSettings();
  if (!settings?.password) return 'needs-auth';

  try {
    await getCalendars({
      serverUrl: settings.serverUrl,
      username: settings.username,
      password: settings.password,
      settingId: settings.id ?? undefined,
    });
    localStorage.removeItem('caldavAuthError');
    return 'success';
  } catch {
    return 'error';
  }
};
