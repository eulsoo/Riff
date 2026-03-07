import { Event } from '../types';
import { CalendarMetadata, normalizeCalendarUrl, getCalDAVSyncSettings } from './api';
import { CalDAVConfig, createCalDavEvent, deleteCalDavEvent, updateCalDavEvent } from './caldav';

interface BaseRemoteSyncParams {
  calendarMetadata: CalendarMetadata[];
}

interface CreateRemoteSyncParams extends BaseRemoteSyncParams {
  inputEvent: Partial<Event>;
  savedEvent: Event;
  onGoogleUidMapped?: (uid: string) => Promise<void>;
}

interface DeleteRemoteSyncParams extends BaseRemoteSyncParams {
  eventToDelete: Event;
}

interface UpdateRemoteSyncParams extends BaseRemoteSyncParams {
  oldEvent: Event;
  updates: Partial<Event>;
}

const findCalendarMeta = (
  calendarMetadata: CalendarMetadata[],
  calendarUrl: string
) => calendarMetadata.find(c => normalizeCalendarUrl(c.url) === normalizeCalendarUrl(calendarUrl));

const isCalDavCalendar = (calendarUrl: string, calMeta?: CalendarMetadata): boolean =>
  calMeta?.type === 'caldav' || calendarUrl.includes('caldav') || calendarUrl.includes('icloud');

const getCalDAVConfig = async (): Promise<CalDAVConfig | null> => {
  const settings = await getCalDAVSyncSettings();
  if (!settings) return null;
  return {
    serverUrl: settings.serverUrl,
    username: settings.username,
    password: settings.password,
    settingId: settings.id,
  };
};

export const syncRemoteEventCreateInBackground = async ({
  inputEvent,
  savedEvent,
  calendarMetadata,
  onGoogleUidMapped,
}: CreateRemoteSyncParams): Promise<void> => {
  try {
    if (!inputEvent.calendarUrl) return;

    const calMeta = findCalendarMeta(calendarMetadata, inputEvent.calendarUrl);
    const isGoogleCalendar = inputEvent.calendarUrl.startsWith('google:');
    const isCalDav = isCalDavCalendar(inputEvent.calendarUrl, calMeta);

    if (isGoogleCalendar) {
      if (calMeta?.readOnly) {
        console.warn('Skipping Google create: Calendar is read-only', inputEvent.calendarUrl);
        return;
      }
      try {
        const { getGoogleProviderToken, uploadEventToGoogle } = await import('../lib/googleCalendar');
        const token = await getGoogleProviderToken();
        if (!token) return;
        const calId = inputEvent.calendarUrl.replace('google:', '');
        console.log('Syncing to Google Calendar (Create - Background)...', inputEvent.title);
        const gId = await uploadEventToGoogle(token, calId, savedEvent);
        if (gId && onGoogleUidMapped) {
          await onGoogleUidMapped(gId);
        } else if (!gId) {
          console.error('Google Calendar creation failed (Background)');
        }
      } catch (e) {
        console.error('Google Sync Create Error (Background):', e);
      }
      return;
    }

    if (isCalDav) {
      if (calMeta?.readOnly) {
        console.warn('Skipping CalDAV create: Calendar is read-only', inputEvent.calendarUrl);
        return;
      }
      const config = await getCalDAVConfig();
      if (!config) return;
      console.log('Syncing to CalDAV (Background)...', inputEvent.title);
      const { success } = await createCalDavEvent(config, inputEvent.calendarUrl, inputEvent);
      if (!success) {
        console.error('CalDAV creation failed (Background)');
      }
    }
  } catch (e) {
    console.error('Remote Sync Error (Background):', e);
  }
};

export const syncRemoteEventDeleteInBackground = async ({
  eventToDelete,
  calendarMetadata,
}: DeleteRemoteSyncParams): Promise<void> => {
  const calendarUrl = eventToDelete.calendarUrl;
  if (!calendarUrl || !eventToDelete.caldavUid) return;

  const calMeta = findCalendarMeta(calendarMetadata, calendarUrl);
  const isGoogleCalendar = calendarUrl.startsWith('google:');
  const isCalDav = isCalDavCalendar(calendarUrl, calMeta);

  if (isGoogleCalendar) {
    if (calMeta?.readOnly) {
      console.warn('Skipping Google delete: Calendar is read-only', calendarUrl);
      return;
    }
    try {
      const { getGoogleProviderToken, deleteEventFromGoogle } = await import('../lib/googleCalendar');
      const token = await getGoogleProviderToken();
      if (token && eventToDelete.caldavUid) {
        const calId = calendarUrl.replace('google:', '');
        console.log('Syncing to Google Calendar (Delete - Background)...', eventToDelete.title);
        const gSuccess = await deleteEventFromGoogle(token, calId, eventToDelete.caldavUid);
        if (!gSuccess) {
          console.error('Google deletion failed (Background)');
        }
      }
    } catch (e) {
      console.error('Google Delete Error (Background):', e);
    }
    return;
  }

  if (isCalDav) {
    if (calMeta?.readOnly) {
      console.warn('Skipping CalDAV delete: Calendar is read-only', calendarUrl);
      return;
    }
    try {
      const config = await getCalDAVConfig();
      if (!config) return;
      console.log('Syncing to CalDAV (Delete - Background)...', eventToDelete.title);
      const { success: caldavSuccess } = await deleteCalDavEvent(config, calendarUrl, eventToDelete.caldavUid);
      if (!caldavSuccess) {
        console.error('CalDAV deletion failed (Background)');
      }
    } catch (e) {
      console.error('CalDAV Delete Error (Background):', e);
    }
  }
};

export const syncRemoteEventUpdateInBackground = async ({
  oldEvent,
  updates,
  calendarMetadata,
}: UpdateRemoteSyncParams): Promise<void> => {
  const targetCalendarUrl = updates.calendarUrl || oldEvent.calendarUrl;
  if (!targetCalendarUrl) return;

  try {
    const calMeta = findCalendarMeta(calendarMetadata, targetCalendarUrl);
    const isGoogleCalendar = targetCalendarUrl.startsWith('google:');
    const isCalDav = isCalDavCalendar(targetCalendarUrl, calMeta);
    const uid = updates.caldavUid || oldEvent.caldavUid;
    const mergedEvent = { ...oldEvent, ...updates };

    if (isGoogleCalendar && uid) {
      if (calMeta?.readOnly) {
        console.warn('Skipping Google update: Calendar is read-only', targetCalendarUrl);
        return;
      }
      try {
        const { getGoogleProviderToken, updateEventInGoogle } = await import('../lib/googleCalendar');
        const token = await getGoogleProviderToken();
        if (!token) return;
        const calId = targetCalendarUrl.replace('google:', '');
        console.log('Syncing to Google Calendar (Update - Background)...', mergedEvent.title);
        const isMovingCalendar = updates.calendarUrl && normalizeCalendarUrl(updates.calendarUrl) !== normalizeCalendarUrl(oldEvent.calendarUrl || '');

        if (isMovingCalendar && oldEvent.calendarUrl && oldEvent.calendarUrl.startsWith('google:')) {
          const { deleteEventFromGoogle, uploadEventToGoogle } = await import('../lib/googleCalendar');
          await deleteEventFromGoogle(token, oldEvent.calendarUrl.replace('google:', ''), uid);
          await uploadEventToGoogle(token, calId, mergedEvent);
        } else {
          const success = await updateEventInGoogle(token, calId, uid, mergedEvent);
          if (!success) {
            console.error('Google update failed');
          }
        }
      } catch (e) {
        console.error('Google Update Error (Background):', e);
      }
      return;
    }

    if (isCalDav && uid) {
      if (calMeta?.readOnly) {
        console.warn('Skipping CalDAV update: Calendar is read-only', targetCalendarUrl);
        return;
      }
      const config = await getCalDAVConfig();
      if (!config) return;
      const isMovingCalendar = updates.calendarUrl && normalizeCalendarUrl(updates.calendarUrl) !== normalizeCalendarUrl(oldEvent.calendarUrl || '');

      if (isMovingCalendar && oldEvent.calendarUrl) {
        console.log(`Moving event ${uid} from ${oldEvent.calendarUrl} to ${targetCalendarUrl}`);
        const { success: deleteSuccess } = await deleteCalDavEvent(config, oldEvent.calendarUrl, uid);
        if (!deleteSuccess) console.error('CalDAV Move: Failed to delete from old calendar', oldEvent.calendarUrl);
        const { success: createSuccess } = await createCalDavEvent(config, targetCalendarUrl, mergedEvent);
        if (!createSuccess) console.error('CalDAV Move: Failed to create in new calendar', targetCalendarUrl);
      } else {
        console.log(`Updating event ${uid} in ${targetCalendarUrl}`);
        const { success } = await updateCalDavEvent(config, targetCalendarUrl, uid, mergedEvent);
        if (!success) console.error('CalDAV update failed');
      }
    }
  } catch (e) {
    console.error('Remote Background Update Error:', e);
  }
};
