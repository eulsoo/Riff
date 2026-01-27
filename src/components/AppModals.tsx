import { Event, Routine, WeekOrder } from '../types';
import { CalendarMetadata } from '../services/api';
import { CalDAVSyncModal } from './CalDAVSyncModal';
import { EventModal } from './EventModal';
import { RoutineModal } from './RoutineModal';
import { SettingsModal } from './SettingsModal';

interface AppModalsProps {
  selectedDate: string | null;
  isEventModalOpen: boolean;
  selectedEvent: Event | null;
  draftEvent: Event | null;
  modalSessionId: number;
  routines: Routine[];
  calendars: CalendarMetadata[];
  popupPosition?: {
    anchorId: string;
    align: 'left' | 'right';
  } | null;
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
  onCloseCalDAVModal: () => void;
  onSyncComplete: (count: number) => void;
  onCloseSettings: () => void;
  onSettingsSaved: (data: { avatarUrl: string | null; weekOrder: WeekOrder }) => void;
  onDraftUpdate?: (updates: Partial<Event>) => void;
}

export function AppModals({
  selectedDate,
  isEventModalOpen,
  selectedEvent,
  draftEvent,
  modalSessionId,
  routines,
  calendars,
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
  onCloseCalDAVModal,
  onSyncComplete,
  onCloseSettings,
  onSettingsSaved,
  onDraftUpdate,
}: AppModalsProps) {
  return (
    <>
      {isEventModalOpen && selectedDate && (
        <EventModal
          key={`session-${modalSessionId}`}
          date={selectedDate}
          initialTitle={draftEvent?.title}
          event={selectedEvent || undefined}
          calendars={calendars}
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
        />
      )}

      {isCalDAVModalOpen && (
        <CalDAVSyncModal
          onClose={onCloseCalDAVModal}
          onSyncComplete={onSyncComplete}
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
