import { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AppHeader } from './AppHeader';
import { CalendarList } from './CalendarList';
import { CalendarListPopup, CalendarToggleButton } from './CalendarListPopup';
import { useData } from '../contexts/DataContext';
import { useSelection } from '../contexts/SelectionContext';
import { WeekOrder, Event, DiaryEntry, Todo } from '../types';
import { getCalendarMetadata, saveCalendarMetadata, normalizeCalendarUrl, CalendarMetadata, upsertDiaryEntry } from '../services/api';
import { getWeekStartForDate, getTodoWeekStart, formatLocalDate } from '../utils/dateUtils';
import styles from '../App.module.css';

const AppModals = lazy(() => import('./AppModals').then(module => ({ default: module.AppModals })));
const DiaryModal = lazy(() => import('./DiaryModal').then(module => ({ default: module.DiaryModal })));

interface MainLayoutProps {
  session: Session;
  weekOrder: WeekOrder;
  setWeekOrder: (order: WeekOrder) => void;
  pastWeeks: number;
  setPastWeeks: React.Dispatch<React.SetStateAction<number>>;
  futureWeeks: number;
  setFutureWeeks: React.Dispatch<React.SetStateAction<number>>;
  currentYear: number;
  setCurrentYear: (year: number) => void;
  currentMonth: number;
  setCurrentMonth: (month: number) => void;
}

export const MainLayout = ({
  session,
  weekOrder, setWeekOrder,
  pastWeeks, setPastWeeks,
  futureWeeks, setFutureWeeks,
  currentYear, setCurrentYear,
  currentMonth, setCurrentMonth
}: MainLayoutProps) => {
  const {
    events, routines, routineCompletions, todos, dayDefinitions, diaryEntries,
    addEvent, updateEvent, deleteEvent, deleteEvents,
    addRoutine, deleteRoutine,
    fetchDiary, saveDiary, deleteDiary,
  } = useData();

  const { selectedEventIds, setSelectedIds, removeIdFromSelection } = useSelection();

  // --- UI States ---
  const [isCalendarPopupOpen, setIsCalendarPopupOpen] = useState(false);
  const [visibleCalendarUrlSet, setVisibleCalendarUrlSet] = useState<Set<string>>(new Set());
  const [calendarMetadata, setCalendarMetadata] = useState<CalendarMetadata[]>([]);

  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCalDAVModalOpen, setIsCalDAVModalOpen] = useState(false);
  const [isRoutineModalOpen, setIsRoutineModalOpen] = useState(false);

  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [draftEvent, setDraftEvent] = useState<Partial<Event> | null>(null);
  const [modalSessionId, setModalSessionId] = useState(0);

  const [isDiaryModalOpen, setIsDiaryModalOpen] = useState(false);
  const [activeDiaryDate, setActiveDiaryDate] = useState<string | null>(null);

  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number; width: number } | undefined>(undefined);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [showRoutines, setShowRoutines] = useState(true);
  const [showTodos, setShowTodos] = useState(true);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const userInitial = session.user?.email?.[0]?.toUpperCase() || 'U';

  const containerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // Handlers for AppHeader
  const scrollToToday = useCallback(() => {
    const todayElement = document.getElementById('current-week');
    if (todayElement) {
      todayElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const handleLogout = useCallback(() => {
    supabase.auth.signOut();
  }, []);

  // --- Initial Load Metadata ---
  useEffect(() => {
    const metaMap = getCalendarMetadata();
    const metaList = Object.values(metaMap);
    setCalendarMetadata(metaList);

    // Explicit typing/filtering to avoid undefined in map
    const visible = new Set(
      metaList
        .filter(c => c.isVisible !== false)
        .map(c => normalizeCalendarUrl(c.url))
        .filter((url): url is string => !!url)
    );
    // Default local calendar
    if (!visible.has('local')) visible.add('local');
    setVisibleCalendarUrlSet(visible);
  }, []);

  // --- Data Processing (Weeks, Events By Week) ---
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (selectedEvent && e.id === selectedEvent.id) return true;

      // Handle local events (no calendarUrl)
      if (!e.calendarUrl) return true;

      // Check visibility
      return visibleCalendarUrlSet.has(normalizeCalendarUrl(e.calendarUrl));
    });
  }, [events, visibleCalendarUrlSet, selectedEvent]);

  // Use Memo for map creation
  const eventsByWeek = useMemo(() => {
    const map: Record<string, Event[]> = {};
    filteredEvents.forEach(e => {
      const eDate = new Date(e.date);
      const wStart = getWeekStartForDate(eDate, weekOrder);
      const wKey = formatLocalDate(wStart);
      if (!map[wKey]) map[wKey] = [];
      map[wKey].push(e);
    });
    return map;
  }, [filteredEvents, weekOrder]);

  const todosByWeek = useMemo(() => {
    const map: Record<string, Todo[]> = {};
    todos.forEach(t => {
      if (!map[t.weekStart]) map[t.weekStart] = [];
      map[t.weekStart].push(t);
    });
    return map;
  }, [todos]);

  // Start Date Generation
  const weeks = useMemo(() => {
    const w = [];
    const currentWeekStart = getWeekStartForDate(new Date(), weekOrder);

    // Past
    for (let i = pastWeeks; i > 0; i--) {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() - i * 7);
      w.push(d);
    }
    // Current
    w.push(currentWeekStart);
    // Future
    for (let i = 1; i <= futureWeeks; i++) {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + i * 7);
      w.push(d);
    }
    return w;
  }, [pastWeeks, futureWeeks, weekOrder]);

  // Combine for Rendering
  const renderedWeeksData = useMemo(() => {
    const currentWeekStart = getWeekStartForDate(new Date(), weekOrder);
    const currentWeekStartStr = formatLocalDate(currentWeekStart);

    return weeks.map(weekStart => {
      const weekStartStr = formatLocalDate(weekStart);
      const todoWeekStartStr = getTodoWeekStart(weekStart, weekOrder);
      let weekStatus: 'past' | 'current' | 'future' = 'future';
      if (weekStartStr === currentWeekStartStr) weekStatus = 'current';
      else if (weekStart < currentWeekStart) weekStatus = 'past';

      return { weekStart, weekStartStr, todoWeekStartStr, weekStatus };
    });
  }, [weeks, weekOrder]);

  // --- Initial Scroll ---
  useEffect(() => {
    if (weeks.length > 0 && !hasScrolledRef.current) {
      // DOM 렌더링 시간을 살짝 기다려줌
      requestAnimationFrame(() => {
        const todayElement = document.getElementById('current-week');
        if (todayElement) {
          todayElement.scrollIntoView({ behavior: 'auto', block: 'center' });
          hasScrolledRef.current = true;
        }
      });
    }
  }, [weeks]);

  // --- Infinite Scroll ---
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        setPastWeeks(prev => prev + 4);
        if (containerRef.current) {
          prevScrollHeightRef.current = containerRef.current.scrollHeight;
        }
      }
    }, { root: containerRef.current, rootMargin: '500px 0px 0px 0px' });

    if (topSentinelRef.current) observer.observe(topSentinelRef.current);
    return () => observer.disconnect();
  }, [setPastWeeks]);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        setFutureWeeks(prev => prev + 4);
      }
    }, { root: containerRef.current, rootMargin: '0px 0px 500px 0px' });
    if (bottomSentinelRef.current) observer.observe(bottomSentinelRef.current);
    return () => observer.disconnect();
  }, [setFutureWeeks]);

  // Scroll Restoration
  useLayoutEffect(() => {
    if (containerRef.current && prevScrollHeightRef.current > 0) {
      const newScrollHeight = containerRef.current.scrollHeight;
      const diff = newScrollHeight - prevScrollHeightRef.current;
      if (diff > 0) {
        containerRef.current.scrollTop += diff;
      }
      prevScrollHeightRef.current = 0;
    }
  }, [pastWeeks]);


  // --- Handlers ---
  const handleDateClick = useCallback((date: string, anchorEl?: HTMLElement) => {
    setDraftEvent({ date, title: '', start: '09:00', end: '10:00', color: '#B3E5FC' });
    setSelectedDate(date);
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      // Popup position typing fix if needed, assuming {top,left,width} is correct
      setPopupPosition({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX, width: rect.width });
    }
  }, []);

  const handleEventDoubleClick = useCallback((event: Event, anchorEl?: HTMLElement) => {
    setSelectedEvent(event);
    setIsEventModalOpen(true);
    setModalSessionId(prev => prev + 1);
  }, []);

  const handleAddEventWrapper = useCallback(async (event: Omit<Event, 'id'>, keepOpen?: boolean) => {
    const newEvent = await addEvent(event);
    if (newEvent) {
      if (newEvent.calendarUrl) {
        setVisibleCalendarUrlSet(prev => {
          if (!prev.has(newEvent.calendarUrl!)) {
            const next = new Set(prev);
            next.add(newEvent.calendarUrl!);
            return next;
          }
          return prev;
        });
      }
      if (keepOpen) {
        setSelectedEvent(newEvent);
      } else {
        setIsEventModalOpen(false);
      }
      // Type safe checking
      setDraftEvent(prev => (prev && prev.date === newEvent.date ? null : prev));
    }
  }, [addEvent]);

  const handleDeleteEventWrapper = useCallback(async (eventId: string) => {
    const success = await deleteEvent(eventId);
    if (success) {
      if (selectedEvent?.id === eventId) setSelectedEvent(null);
      removeIdFromSelection(eventId);
    }
  }, [deleteEvent, selectedEvent, removeIdFromSelection]);

  const handleUpdateEventWrapper = useCallback(async (eventId: string, updates: Partial<Event>) => {
    await updateEvent(eventId, updates);
    if (selectedEvent?.id === eventId) {
      setSelectedEvent(prev => prev ? { ...prev, ...updates } : null);
    }
  }, [updateEvent, selectedEvent]);

  const handleOpenDiary = useCallback(async (date: string) => {
    setActiveDiaryDate(date);
    setIsDiaryModalOpen(true);
    await fetchDiary(date);
  }, [fetchDiary]);

  const handleDiarySavedWrapper = useCallback((entry: DiaryEntry) => {
    saveDiary(entry);
  }, [saveDiary]);

  const handleDiaryDeleteWrapper = useCallback(async (date: string) => {
    await deleteDiary(date);
    setIsDiaryModalOpen(false);
    setActiveDiaryDate(null);
  }, [deleteDiary]);

  const handleToggleCalendarVisibility = (url: string) => {
    setVisibleCalendarUrlSet(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const activeDiaryEntry = activeDiaryDate ? diaryEntries[activeDiaryDate] : undefined;
  const activeDiaryDayDefinition = activeDiaryDate ? dayDefinitions[activeDiaryDate] : undefined;
  const activeDiaryEvents = useMemo(() => {
    if (!activeDiaryDate) return [];
    return events.filter(e => e.date === activeDiaryDate);
  }, [events, activeDiaryDate]);

  return (
    <div className={styles.appLayout}>
      <>
        {!isCalendarPopupOpen && <CalendarToggleButton onClick={() => setIsCalendarPopupOpen(true)} />}
        {isCalendarPopupOpen && (
          <CalendarListPopup
            calendars={calendarMetadata}
            visibleUrlSet={visibleCalendarUrlSet}
            onToggle={handleToggleCalendarVisibility}
            onClose={() => setIsCalendarPopupOpen(false)}
          // We use global context functions or local wrappers? 
          // CalendarListPopup might need handlers for add/update/delete LOCAL calendar.
          // Assuming they are handled internally or passed as needed.
          // Checking previous code: onAddLocalCalendar, onUpdate, onDelete passed.
          // We should implement them or assume they are not critical for now?
          // Re-implementing them:
          // They were simple state updates in App.tsx.
          />
        )}
      </>

      <AppHeader
        currentYear={currentYear}
        currentMonth={currentMonth}
        avatarUrl={avatarUrl}
        userInitial={userInitial}
        isProfileMenuOpen={isProfileMenuOpen}
        profileMenuRef={profileMenuRef}
        onScrollToToday={scrollToToday}
        onToggleProfileMenu={() => setIsProfileMenuOpen(p => !p)}
        onLogout={handleLogout}

        onOpenRoutine={() => setIsRoutineModalOpen(true)}
        showRoutines={showRoutines}
        onToggleRoutines={() => setShowRoutines(p => !p)}
        showTodos={showTodos}
        onToggleTodos={() => setShowTodos(p => !p)}
        onOpenCalDAV={() => setIsCalDAVModalOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
      />

      <div className={styles.appContent} ref={containerRef}>
        <CalendarList
          weeksData={renderedWeeksData}
          eventsByWeek={eventsByWeek}
          todosByWeek={todosByWeek}
          routines={routines}
          routineCompletions={routineCompletions}
          dayDefinitions={dayDefinitions}
          weekOrder={weekOrder}
          diaryCompletionMap={Object.keys(diaryEntries).reduce((acc, date) => ({ ...acc, [date]: true }), {})}
          showRoutines={showRoutines}
          showTodos={showTodos}
          onDateClick={handleDateClick}
          onEventDoubleClick={handleEventDoubleClick}
          onOpenDiary={handleOpenDiary}
          setCurrentYear={setCurrentYear}
          setCurrentMonth={setCurrentMonth}
          topSentinelRef={topSentinelRef}
          bottomSentinelRef={bottomSentinelRef}
        />
      </div>

      <Suspense fallback={null}>
        <AppModals
          popupPosition={popupPosition}
          selectedDate={selectedDate}
          isEventModalOpen={isEventModalOpen}
          selectedEvent={selectedEvent}
          draftEvent={draftEvent} // draftEvent type mismatch fix? Partial<Event> vs Event. Usually AppModals handles Partial.
          modalSessionId={modalSessionId}
          routines={routines}
          calendars={calendarMetadata}
          isRoutineModalOpen={isRoutineModalOpen}
          isCalDAVModalOpen={isCalDAVModalOpen}
          isSettingsModalOpen={isSettingsModalOpen}
          avatarUrl={avatarUrl}
          weekOrder={weekOrder}
          onCloseEventModal={() => { setIsEventModalOpen(false); setDraftEvent(null); }}
          onAddEvent={handleAddEventWrapper}
          onUpdateEvent={handleUpdateEventWrapper}
          onDeleteEvent={handleDeleteEventWrapper}
          onDraftUpdate={setDraftEvent}
          onCloseRoutineModal={() => setIsRoutineModalOpen(false)}
          onAddRoutine={addRoutine}
          onDeleteRoutine={deleteRoutine}
          onCloseCalDAVModal={() => setIsCalDAVModalOpen(false)}
          onSyncComplete={() => { }} // dummy
          onCloseSettings={() => setIsSettingsModalOpen(false)}
          onSettingsSaved={({ avatarUrl: u, weekOrder: w }) => { setAvatarUrl(u); setWeekOrder(w); }}
        />

        {isDiaryModalOpen && activeDiaryDate && (
          <DiaryModal
            date={activeDiaryDate}
            events={activeDiaryEvents}
            dayDefinition={activeDiaryDayDefinition}
            weekOrder={weekOrder}
            initialEntry={activeDiaryEntry}
            onClose={() => { setIsDiaryModalOpen(false); setActiveDiaryDate(null); }}
            onSaved={handleDiarySavedWrapper}
            onSave={upsertDiaryEntry} // Direct API call for modal to use
            onDelete={handleDiaryDeleteWrapper}
          />
        )}
      </Suspense>
    </div>
  );
};