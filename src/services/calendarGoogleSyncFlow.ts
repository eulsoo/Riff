import { CalendarMetadata } from './api';
import {
  createGoogleCalendar,
  deleteGoogleCalendar,
  fetchGoogleCalendarList,
  getGoogleProviderToken,
  type GoogleCalendarMutationError,
} from '../lib/googleCalendar';

export type SyncLocalCalendarToGoogleResult =
  | { status: 'needs-auth' }
  | { status: 'success'; newCalendar: CalendarMetadata }
  | { status: 'error'; message: string };

const isGoogleAuthError = (error: unknown): boolean => {
  const code = (error as GoogleCalendarMutationError | undefined)?.code;
  if (code === 'AUTH') return true;
  const message = String((error as Error | undefined)?.message || '');
  return message.includes('401') || message.includes('invalid_grant');
};

const normalizeName = (name?: string): string => (name || '').trim().toLowerCase();

export const syncLocalCalendarToGoogle = async (
  calendar: CalendarMetadata
): Promise<SyncLocalCalendarToGoogleResult> => {
  const token = await getGoogleProviderToken();
  if (!token) return { status: 'needs-auth' };

  try {
    const targetName = normalizeName(calendar.displayName);
    const list = await fetchGoogleCalendarList(token);
    const existing = list.find(
      gc => normalizeName(gc.summary) === targetName
    );

    const created = existing
      ? { id: existing.id, summary: existing.summary, backgroundColor: existing.backgroundColor }
      : await createGoogleCalendar(token, calendar.displayName, calendar.color);

    return {
      status: 'success',
      newCalendar: {
        url: `google:${created.id}`,
        displayName: created.summary || calendar.displayName,
        color: created.backgroundColor || calendar.color,
        type: 'google',
        googleCalendarId: created.id,
        readOnly: false,
        isVisible: true,
        isLocal: false,
        createdFromApp: true,
      },
    };
  } catch (error) {
    if (isGoogleAuthError(error)) {
      return { status: 'needs-auth' };
    }
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Google 캘린더 생성에 실패했습니다.',
    };
  }
};

export const deleteGoogleCalendarById = async (calendarId: string): Promise<void> => {
  const token = await getGoogleProviderToken();
  if (!token) {
    throw new Error('Google 연결이 만료되었습니다. 다시 연결 후 시도해주세요.');
  }
  await deleteGoogleCalendar(token, calendarId);
};
