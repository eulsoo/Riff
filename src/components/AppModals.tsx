import { Event, Routine, WeekOrder } from '../types';
import { CalendarMetadata } from '../services/api';
import { CalDAVSyncModal } from './CalDAVSyncModal';
import { GoogleSyncModal } from './GoogleSyncModal';
import { EventModal } from './EventModal';
import { RoutineModal } from './RoutineModal';
import { ModalPosition } from './EventModal';
import { SettingsModal } from './SettingsModal';

interface AppModalsProps {
  selectedDate: string | null;
  isEventModalOpen: boolean;
  selectedEvent: Event | null;
  draftEvent: Event | null;
  modalSessionId: number;
  routines: Routine[];
  calendars: CalendarMetadata[];
  allCalendars?: CalendarMetadata[];
  popupPosition?: ModalPosition | null;
  isRoutineModalOpen: boolean;
  isCalDAVModalOpen: boolean;
  isSettingsModalOpen: boolean;
  avatarUrl: string | null;
  weekOrder: WeekOrder;
  onCloseEventModal: () => void;
  onAddEvent: (event: Omit<Event, 'id'>, keepOpen?: boolean) => void;
  onUpdateEvent: (eventId: string, updates: Partial<Event>) => void;
  onDeleteEvent: (eventId: string) => void;
  onCloseRoutineModal: () => void;
  onAddRoutine: (routine: Omit<Routine, 'id'>) => void;
  onDeleteRoutine: (routineId: string) => void;
  onUpdateRoutine: (routineId: string, updates: Partial<Omit<Routine, 'id'>>) => void;
  onCloseCalDAVModal: () => void;
  onCalDAVAuthSuccess?: () => void;
  onSyncComplete: (count: number, syncedCalendarUrls?: string[]) => void;
  onCloseSettings: () => void;
  onSettingsSaved: (data: { avatarUrl: string | null; weekOrder: WeekOrder }) => void;
  onDraftUpdate?: (updates: Partial<Event>) => void;
  // Google
  isGoogleSyncModalOpen: boolean;
  onCloseGoogleSyncModal: () => void;
  onGoogleSyncComplete: (selected: CalendarMetadata[]) => void;
  onGoogleDisconnect: () => void;
  googleCalendars: CalendarMetadata[];
  calDAVAuthNoticeMessage?: string;
  googleSyncMode?: 'sync' | 'auth-only';
  googleAuthNoticeMessage?: string;
  onGoogleTokenRecovered?: () => void;
}

export function AppModals({
  selectedDate,
  isEventModalOpen,
  selectedEvent,
  draftEvent,
  modalSessionId,
  routines,
  calendars,
  allCalendars,
  popupPosition,
  isRoutineModalOpen,
  isCalDAVModalOpen,
  isSettingsModalOpen,
  avatarUrl,
  weekOrder,
  onCloseEventModal,
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
  onCloseRoutineModal,
  onAddRoutine,
  onDeleteRoutine,
  onUpdateRoutine,
  onCloseCalDAVModal,
  onCalDAVAuthSuccess,
  onSyncComplete,
  onCloseSettings,
  onSettingsSaved,
  onDraftUpdate,
  calDAVMode = 'sync',
  isGoogleSyncModalOpen,
  onCloseGoogleSyncModal,
  onGoogleSyncComplete,
  onGoogleDisconnect,
  googleCalendars,
  calDAVAuthNoticeMessage,
  googleSyncMode = 'sync',
  googleAuthNoticeMessage,
  onGoogleTokenRecovered,
}: AppModalsProps & { calDAVMode?: 'sync' | 'auth-only' }) {
  return (
    <>
      {isEventModalOpen && selectedDate && (
        <EventModal
          key={`session-${modalSessionId}`}
          date={selectedDate}
          initialTitle={draftEvent?.title}
          initialStartTime={draftEvent?.startTime}
          initialEndTime={draftEvent?.endTime}
          event={selectedEvent || undefined}
          calendars={calendars}
          allCalendars={allCalendars}
          position={popupPosition}
          onClose={onCloseEventModal}
          onSave={onAddEvent}
          onUpdate={onUpdateEvent}
          onDelete={onDeleteEvent}
          onDraftUpdate={onDraftUpdate}
        />
      )}

      {isRoutineModalOpen && (
        <RoutineModal
          routines={routines}
          onClose={onCloseRoutineModal}
          onAdd={onAddRoutine}
          onDelete={onDeleteRoutine}
          onUpdate={onUpdateRoutine}
        />
      )}

      {isCalDAVModalOpen && (
        <CalDAVSyncModal
          onClose={onCloseCalDAVModal}
          onSyncComplete={onSyncComplete}
          mode={calDAVMode}
          existingCalendars={calendars}
          authNoticeMessage={calDAVAuthNoticeMessage}
          onCalDAVAuthSuccess={onCalDAVAuthSuccess}
        />
      )}

      {isGoogleSyncModalOpen && (
        <GoogleSyncModal
          onClose={onCloseGoogleSyncModal}
          onSyncComplete={onGoogleSyncComplete}
          onDisconnect={onGoogleDisconnect}
          existingGoogleCalendars={googleCalendars}
          mode={googleSyncMode}
          authNoticeMessage={googleAuthNoticeMessage}
          onTokenRecovered={onGoogleTokenRecovered}
        />
      )}

      {isSettingsModalOpen && (
        <SettingsModal
          onClose={onCloseSettings}
          initialAvatarUrl={avatarUrl}
          initialWeekOrder={weekOrder}
          onSaved={onSettingsSaved}
        />
      )}
    </>
  );
}
