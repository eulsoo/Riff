import { Event, Routine, WeekOrder } from '../App';
import { CalDAVSyncModal } from './CalDAVSyncModal';
import { EventDetailModal } from './EventDetailModal';
import { EventModal } from './EventModal';
import { RoutineModal } from './RoutineModal';
import { SettingsModal } from './SettingsModal';

interface AppModalsProps {
  selectedDate: string | null;
  isEventModalOpen: boolean;
  selectedEvent: Event | null;
  routines: Routine[];
  isRoutineModalOpen: boolean;
  isCalDAVModalOpen: boolean;
  isSettingsModalOpen: boolean;
  avatarUrl: string | null;
  weekOrder: WeekOrder;
  onCloseEventModal: () => void;
  onAddEvent: (event: Omit<Event, 'id'>) => void;
  onCloseEventDetail: () => void;
  onUpdateEvent: (eventId: string, updates: Partial<Event>) => void;
  onDeleteEvent: (eventId: string) => void;
  onCloseRoutineModal: () => void;
  onAddRoutine: (routine: Omit<Routine, 'id'>) => void;
  onDeleteRoutine: (routineId: string) => void;
  onCloseCalDAVModal: () => void;
  onSyncComplete: (count: number) => void;
  onCloseSettings: () => void;
  onSettingsSaved: (data: { avatarUrl: string | null; weekOrder: WeekOrder }) => void;
}

export function AppModals({
  selectedDate,
  isEventModalOpen,
  selectedEvent,
  routines,
  isRoutineModalOpen,
  isCalDAVModalOpen,
  isSettingsModalOpen,
  avatarUrl,
  weekOrder,
  onCloseEventModal,
  onAddEvent,
  onCloseEventDetail,
  onUpdateEvent,
  onDeleteEvent,
  onCloseRoutineModal,
  onAddRoutine,
  onDeleteRoutine,
  onCloseCalDAVModal,
  onSyncComplete,
  onCloseSettings,
  onSettingsSaved,
}: AppModalsProps) {
  return (
    <>
      {isEventModalOpen && selectedDate && (
        <EventModal
          date={selectedDate}
          onClose={onCloseEventModal}
          onSave={onAddEvent}
        />
      )}

      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          onClose={onCloseEventDetail}
          onUpdate={onUpdateEvent}
          onDelete={onDeleteEvent}
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
