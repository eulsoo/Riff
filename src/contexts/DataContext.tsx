import { createContext, useContext, ReactNode, useCallback, useRef, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { useAppData } from '../hooks/useAppData';
import {
  Event, Routine, RoutineCompletion, Todo, DiaryEntry, WeekOrder
} from '../types';
import {
  createEvent, deleteEvent as apiDeleteEvent, updateEvent as apiUpdateEvent,
  createRoutine, deleteRoutine as apiDeleteRoutine,
  toggleRoutineCompletion,
  createTodo, updateTodo as apiUpdateTodo, deleteTodo as apiDeleteTodo,
  upsertDayDefinition, deleteDayDefinition as apiDeleteDayDefinition,
  fetchDiaryEntry, deleteDiaryEntry as apiDeleteDiaryEntry,
  upsertDiaryEntry
} from '../services/api';

interface DataContextType {
  // State
  events: Event[];
  routines: Routine[];
  routineCompletions: RoutineCompletion[];
  todos: Todo[];
  dayDefinitions: Record<string, string>;
  diaryEntries: Record<string, DiaryEntry>;

  // Actions - Events
  addEvent: (event: Omit<Event, 'id'>) => Promise<Event | null>;
  deleteEvent: (eventId: string) => Promise<boolean>;
  updateEvent: (eventId: string, updates: Partial<Event>) => Promise<void>;
  deleteEvents: (eventIds: string[]) => Promise<string[]>; // Returns deleted IDs

  // Actions - Routines
  addRoutine: (routine: Omit<Routine, 'id'>) => Promise<Routine | null>;
  deleteRoutine: (routineId: string) => Promise<boolean>;
  toggleRoutine: (routineId: string, date: string) => Promise<void>;

  // Actions - Todos
  addTodo: (weekStart: string, text: string) => Promise<Todo | null>;
  toggleTodo: (todoId: string) => Promise<void>;
  updateTodo: (todoId: string, text: string) => Promise<void>;
  deleteTodo: (todoId: string) => Promise<boolean>;

  // Actions - Day Definitions
  saveDayDefinition: (date: string, text: string) => Promise<void>;
  deleteDayDefinition: (date: string) => Promise<void>;

  // Actions - Diary
  fetchDiary: (date: string) => Promise<DiaryEntry | null>; // Just fetch, state update handled internally if needed
  saveDiary: (entry: DiaryEntry) => Promise<void>;
  deleteDiary: (date: string) => Promise<boolean>;

  // Data Loading
  loadData: (force?: boolean) => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

interface DataProviderProps {
  children: ReactNode;
  session: Session | null;
  pastWeeks: number;
  futureWeeks: number;
  weekOrder: WeekOrder;
  getWeekStartForDate: (date: Date) => Date;
  getCurrentTodoWeekStart: () => string;
  formatLocalDate: (date: Date) => string;
}

export const DataProvider = ({
  children,
  session,
  pastWeeks,
  futureWeeks,
  weekOrder,
  getWeekStartForDate,
  getCurrentTodoWeekStart,
  formatLocalDate
}: DataProviderProps) => {
  const {
    events, setEvents,
    routines, setRoutines,
    routineCompletions, setRoutineCompletions,
    todos, setTodos,
    dayDefinitions, setDayDefinitions,
    diaryEntries, setDiaryEntries,
    loadData
  } = useAppData(
    session,
    pastWeeks,
    futureWeeks,
    weekOrder,
    getWeekStartForDate,
    getCurrentTodoWeekStart,
    formatLocalDate
  );

  const debouncedUpdateRef = useRef<Record<string, NodeJS.Timeout>>({});
  const diaryInFlightRef = useRef<Record<string, Promise<DiaryEntry | null>>>({});

  // Initial Data Load & Refetch on session/range change
  useEffect(() => {
    if (session) {
      loadData();
    }
  }, [session, loadData]);

  // --- Events ---
  const addEvent = useCallback(async (event: Omit<Event, 'id'>) => {
    const newEvent = await createEvent(event);
    if (newEvent) {
      setEvents(prev => [...prev, newEvent]);
    }
    return newEvent;
  }, [setEvents]);

  const deleteEvent = useCallback(async (eventId: string) => {
    const success = await apiDeleteEvent(eventId);
    if (success) {
      setEvents(prev => prev.filter(e => e.id !== eventId));
    }
    return success;
  }, [setEvents]);

  const updateEvent = useCallback(async (eventId: string, updates: Partial<Event>) => {
    // Optimistic Update
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, ...updates } : e));

    // Debounce API call
    if (debouncedUpdateRef.current[eventId]) {
      clearTimeout(debouncedUpdateRef.current[eventId]);
    }

    debouncedUpdateRef.current[eventId] = setTimeout(async () => {
      await apiUpdateEvent(eventId, updates);
      delete debouncedUpdateRef.current[eventId];
    }, 1000);
  }, [setEvents]);

  const deleteEvents = useCallback(async (eventIds: string[]) => {
    if (eventIds.length === 0) return [];
    const results = await Promise.all(eventIds.map(id => apiDeleteEvent(id)));
    const deletedIds = eventIds.filter((_, idx) => results[idx]);
    if (deletedIds.length > 0) {
      setEvents(prev => prev.filter(e => !deletedIds.includes(e.id)));
    }
    return deletedIds;
  }, [setEvents]);

  // --- Routines ---
  const addRoutine = useCallback(async (routine: Omit<Routine, 'id'>) => {
    const newRoutine = await createRoutine(routine);
    if (newRoutine) {
      setRoutines(prev => [...prev, newRoutine]);
    }
    return newRoutine;
  }, [setRoutines]);

  const deleteRoutine = useCallback(async (routineId: string) => {
    const success = await apiDeleteRoutine(routineId);
    if (success) {
      setRoutines(prev => prev.filter(r => r.id !== routineId));
      setRoutineCompletions(prev => prev.filter(rc => rc.routineId !== routineId));
    }
    return success;
  }, [setRoutines, setRoutineCompletions]);

  const toggleRoutine = useCallback(async (routineId: string, date: string) => {
    setRoutineCompletions(prev => {
      const existing = prev.find(rc => rc.routineId === routineId && rc.date === date);
      const completed = existing ? !existing.completed : true;

      toggleRoutineCompletion(routineId, date, completed).then(updated => {
        if (!updated) {
          // Handle error rollback if needed
        }
      });

      if (existing) {
        return prev.map(rc =>
          rc.routineId === routineId && rc.date === date
            ? { ...rc, completed }
            : rc
        );
      } else {
        return [...prev, { routineId, date, completed, id: 'temp-id', createdAt: new Date().toISOString() }];
      }
    });
  }, [setRoutineCompletions]);

  // --- Todos ---
  const addTodo = useCallback(async (weekStart: string, text: string) => {
    const newTodo = await createTodo({
      weekStart,
      text,
      completed: false,
    });
    if (newTodo) {
      setTodos(prev => [...prev, newTodo]);
    }
    return newTodo;
  }, [setTodos]);

  const toggleTodo = useCallback(async (todoId: string) => {
    setTodos(prev => {
      const todo = prev.find(t => t.id === todoId);
      if (!todo) return prev;
      const completed = !todo.completed;
      apiUpdateTodo(todoId, { completed });
      return prev.map(t => t.id === todoId ? { ...t, completed } : t);
    });
  }, [setTodos]);

  const updateTodo = useCallback(async (todoId: string, text: string) => {
    const updated = await apiUpdateTodo(todoId, { text });
    if (updated) {
      setTodos(prev => prev.map(t => t.id === todoId ? updated : t));
    }
  }, [setTodos]);

  const deleteTodo = useCallback(async (todoId: string) => {
    const success = await apiDeleteTodo(todoId);
    if (success) {
      setTodos(prev => prev.filter(t => t.id !== todoId));
    }
    return success;
  }, [setTodos]);

  // --- Day Definitions ---
  const saveDayDefinition = useCallback(async (date: string, text: string) => {
    const saved = await upsertDayDefinition(date, text);
    if (saved) {
      setDayDefinitions(prev => ({ ...prev, [date]: text }));
    }
  }, [setDayDefinitions]);

  const deleteDayDefinition = useCallback(async (date: string) => {
    const success = await apiDeleteDayDefinition(date);
    if (success) {
      setDayDefinitions(prev => {
        const next = { ...prev };
        delete next[date];
        return next;
      });
    }
  }, [setDayDefinitions]);

  // --- Diary ---
  const fetchDiary = useCallback(async (date: string) => {
    // Check in-memory state first
    if (diaryEntries[date]) return diaryEntries[date];

    // Check cache
    if (typeof window !== 'undefined') {
      const cached = window.localStorage.getItem(`diaryCache:${date}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as DiaryEntry;
          setDiaryEntries(prev => ({ ...prev, [date]: parsed }));
          return parsed;
        } catch {
          window.localStorage.removeItem(`diaryCache:${date}`);
        }
      }
    }

    // Fetch from API
    if (diaryInFlightRef.current[date]) {
      return diaryInFlightRef.current[date];
    }

    diaryInFlightRef.current[date] = fetchDiaryEntry(date);
    const entry = await diaryInFlightRef.current[date];
    delete diaryInFlightRef.current[date];

    if (entry) {
      setDiaryEntries(prev => ({ ...prev, [date]: entry }));
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`diaryCache:${date}`, JSON.stringify(entry));
      }
    }
    return entry;
  }, [diaryEntries, setDiaryEntries]);

  const saveDiary = useCallback(async (entry: DiaryEntry) => {
    // Note: Assuming upsert is handled by API or optimistic update here?
    // The handleDiarySaved in App.tsx just updated state. 
    // Usually save is triggered by DiaryModal. 
    // Let's assume this updates state and cache. 
    // Actual API save might be in DiaryModal?
    // Checking App.tsx imports: upsertDiaryEntry IS imported in App.tsx but used inside DiaryModal probably?
    // Ah, App.tsx had handleDiarySaved which was called BY DiaryModal after save.
    // So this measure is just for updating local state.

    setDiaryEntries(prev => ({ ...prev, [entry.date]: entry }));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`diaryCache:${entry.date}`, JSON.stringify(entry));
    }
  }, [setDiaryEntries]);

  const deleteDiary = useCallback(async (date: string) => {
    const success = await apiDeleteDiaryEntry(date);
    if (success) {
      setDiaryEntries(prev => {
        const next = { ...prev };
        delete next[date];
        return next;
      });
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(`diaryCache:${date}`);
      }
    }
    return success;
  }, [setDiaryEntries]);


  const value = {
    events, routines, routineCompletions, todos, dayDefinitions, diaryEntries,
    addEvent, deleteEvent, updateEvent, deleteEvents,
    addRoutine, deleteRoutine, toggleRoutine,
    addTodo, toggleTodo, updateTodo, deleteTodo,
    saveDayDefinition, deleteDayDefinition,
    fetchDiary, saveDiary, deleteDiary,
    loadData
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
