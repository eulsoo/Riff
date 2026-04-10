import { CalendarMetadata, fetchEvents, normalizeCalendarUrl, updateEvent } from './api';
import {
  createGoogleCalendar,
  deleteGoogleCalendar,
  fetchGoogleCalendarList,
  getGoogleProviderToken,
  uploadEventToGoogle,
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
const isWritableGoogleCalendar = (accessRole?: string): boolean =>
  accessRole === 'owner' || accessRole === 'writer';

export const syncLocalCalendarToGoogle = async (
  calendar: CalendarMetadata
): Promise<SyncLocalCalendarToGoogleResult> => {
  const token = await getGoogleProviderToken();
  if (!token) return { status: 'needs-auth' };

  try {
    const targetName = normalizeName(calendar.displayName);
    const list = await fetchGoogleCalendarList(token);
    const existing = list.find(
      gc => normalizeName(gc.summary) === targetName && isWritableGoogleCalendar(gc.accessRole)
    );

    const created = existing
      ? { id: existing.id, summary: existing.summary, backgroundColor: existing.backgroundColor }
      : await createGoogleCalendar(token, calendar.displayName, calendar.color);
    const googleCalendarUrl = `google:${created.id}`;

    // 기존 로컬 이벤트를 Google 캘린더로 업로드하고
    // DB의 calendar_url + caldav_uid(google event id 재사용) + source를 동기화
    const existingEvents = await fetchEvents();
    const localEvents = existingEvents.filter(e =>
      normalizeCalendarUrl(e.calendarUrl) === normalizeCalendarUrl(calendar.url)
    );
    let uploadedCount = 0;
    for (const event of localEvents) {
      try {
        const googleEventId = await uploadEventToGoogle(token, created.id, event);
        if (!googleEventId) continue;
        await updateEvent(event.id, {
          calendarUrl: googleCalendarUrl,
          caldavUid: googleEventId,
          source: 'google',
        });
        uploadedCount += 1;
      } catch (e) {
        console.warn('[Google Sync] 이벤트 업로드 실패:', event.title, e);
      }
    }

    if (localEvents.length > 0 && uploadedCount === 0) {
      return {
        status: 'error',
        message: 'Google 캘린더로 이벤트를 업로드하지 못했습니다. 캘린더 권한을 확인해주세요.',
      };
    }

    return {
      status: 'success',
      newCalendar: {
        url: googleCalendarUrl,
        displayName: created.summary || calendar.displayName,
        // Riff 로컬 캘린더 색상을 그대로 유지해 UI 색 일관성 보장
        color: calendar.color,
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
