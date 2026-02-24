import { createContext, useContext, ReactNode, useCallback, useRef, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { useAppData } from '../hooks/useAppData';
import { useUndoRedo, HistoryAction, ActionCategory } from '../hooks/useUndoRedo';
import {
  Event, Routine, Todo, DiaryEntry, WeekOrder
} from '../types';
import {
  createEvent, deleteEvent as apiDeleteEvent, updateEvent as apiUpdateEvent,
  createRoutine, deleteRoutine as apiDeleteRoutine, updateRoutine as apiUpdateRoutine,
  toggleRoutineCompletion,
  createTodo, updateTodo as apiUpdateTodo, deleteTodo as apiDeleteTodo,
  updateTodoPositions,
  fetchDiaryEntry, deleteDiaryEntry as apiDeleteDiaryEntry,
  upsertDiaryEntry
} from '../services/api';

interface DataContextType {
  // State
  events: Event[];
  routines: Routine[];
  routineCompletions: import('../types').RoutineCompletion[];
  todos: Todo[];
  diaryEntries: Record<string, DiaryEntry>;

  // Actions - Events
  addEvent: (event: Omit<Event, 'id'>) => Promise<Event | null>;
  deleteEvent: (eventId: string) => Promise<boolean>;
  updateEvent: (eventId: string, updates: Partial<Event>) => Promise<void>;
  deleteEvents: (eventIds: string[]) => Promise<string[]>;

  // Actions - Routines
  addRoutine: (routine: Omit<Routine, 'id'>) => Promise<Routine | null>;
  deleteRoutine: (routineId: string) => Promise<boolean>;
  updateRoutine: (routineId: string, updates: Partial<Omit<Routine, 'id'>>) => Promise<Routine | null>;
  toggleRoutine: (routineId: string, date: string) => Promise<void>;

  // Actions - Todos
  addTodo: (weekStart: string, text: string, deadline?: string) => Promise<Todo | null>;
  toggleTodo: (todoId: string) => Promise<void>;
  updateTodo: (todoId: string, text: string, deadline?: string) => Promise<void>;
  deleteTodo: (todoId: string) => Promise<boolean>;
  reorderTodos: (weekStart: string, newTodos: Todo[]) => void;

  // Actions - Diary
  fetchDiary: (date: string) => Promise<DiaryEntry | null>;
  saveDiary: (entry: DiaryEntry) => Promise<void>;
  deleteDiary: (date: string) => Promise<boolean>;

  // Undo/Redo
  recordAction: (action: HistoryAction) => void;
  registerCategoryHandlers: (
    category: ActionCategory,
    onUndo: (action: HistoryAction) => Promise<void>,
    onRedo: (action: HistoryAction) => Promise<void>
  ) => void;
  canUndo: boolean;
  canRedo: boolean;

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
    diaryEntries, setDiaryEntries,
    loadData,
    markEventAsDeleted,
    markEventsAsDeleted,
    reorderWeekTodos
  } = useAppData(
    session,
    pastWeeks,
    futureWeeks,
    weekOrder,
    getWeekStartForDate,
    getCurrentTodoWeekStart,
    formatLocalDate
  );

  const { recordAction, registerCategoryHandlers, canUndo, canRedo } = useUndoRedo();

  const debouncedUpdateRef = useRef<Record<string, NodeJS.Timeout>>({});
  const diaryInFlightRef = useRef<Record<string, Promise<DiaryEntry | null>>>({});

  // We need refs to access latest state in undo/redo handlers without stale closures
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const routinesRef = useRef(routines);
  routinesRef.current = routines;
  const todosRef = useRef(todos);
  todosRef.current = todos;

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
    markEventAsDeleted(eventId);
    const success = await apiDeleteEvent(eventId);
    if (success) {
      setEvents(prev => prev.filter(e => e.id !== eventId));
    }
    return success;
  }, [setEvents, markEventAsDeleted]);

  const updateEvent = useCallback(async (eventId: string, updates: Partial<Event>) => {
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, ...updates } : e));
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
    markEventsAsDeleted(eventIds);
    const results = await Promise.all(eventIds.map(id => apiDeleteEvent(id)));
    const deletedIds = eventIds.filter((_, idx) => results[idx]);
    if (deletedIds.length > 0) {
      setEvents(prev => prev.filter(e => !deletedIds.includes(e.id)));
    }
    return deletedIds;
  }, [setEvents, markEventsAsDeleted]);

  // --- Routines (with undo support) ---
  const addRoutine = useCallback(async (routine: Omit<Routine, 'id'>) => {
    const newRoutine = await createRoutine(routine);
    if (newRoutine) {
      setRoutines(prev => [...prev, newRoutine]);
      recordAction({
        category: 'routine',
        type: 'CREATE',
        routine: newRoutine,
        description: `루틴 추가: ${newRoutine.name}`,
      });
    }
    return newRoutine;
  }, [setRoutines, recordAction]);

  const deleteRoutine = useCallback(async (routineId: string) => {
    const routineToDelete = routinesRef.current.find(r => r.id === routineId);
    const success = await apiDeleteRoutine(routineId);
    if (success) {
      setRoutines(prev => prev.filter(r => r.id !== routineId));
      setRoutineCompletions(prev => prev.filter(rc => rc.routineId !== routineId));
      if (routineToDelete) {
        recordAction({
          category: 'routine',
          type: 'DELETE',
          routine: routineToDelete,
          description: `루틴 삭제: ${routineToDelete.name}`,
        });
      }
    }
    return success;
  }, [setRoutines, setRoutineCompletions, recordAction]);

  const updateRoutine = useCallback(async (routineId: string, updates: Partial<Omit<Routine, 'id'>>) => {
    const oldRoutine = routinesRef.current.find(r => r.id === routineId);
    const updated = await apiUpdateRoutine(routineId, updates);
    if (updated) {
      setRoutines(prev => prev.map(r => r.id === routineId ? updated : r));
      if (oldRoutine) {
        recordAction({
          category: 'routine',
          type: 'UPDATE',
          routine: updated,
          prevRoutine: oldRoutine,
          description: `루틴 수정: ${updated.name}`,
        });
      }
    }
    return updated;
  }, [setRoutines, recordAction]);

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

  // ── 중앙 재정렬 + DB 저장 함수 ──
  // 투두 리스트를 정렬 규칙에 따라 재배치하고 position을 DB에 저장
  const resortAndPersist = useCallback((todoList: Todo[]): Todo[] => {
    const completed = todoList.filter(t => t.completed);
    const uncompleted = todoList.filter(t => !t.completed);

    // 완료 그룹: position 순서 유지
    completed.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));

    // 미완료 그룹: deadline ASC (없으면 맨 뒤)
    uncompleted.sort((a, b) => {
      if (!a.deadline && !b.deadline) return (a.position ?? 0) - (b.position ?? 0);
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });

    // position 재할당
    const sorted = [...completed, ...uncompleted];
    const withPositions = sorted.map((t, idx) => ({ ...t, position: idx }));

    // DB에 position 저장 (비동기, 실패해도 UI 불변)
    const positionUpdates = withPositions
      .filter(t => !t.id.startsWith('temp-'))
      .map(t => ({ id: t.id, position: t.position! }));
    if (positionUpdates.length > 0) {
      updateTodoPositions(positionUpdates);
    }

    return withPositions;
  }, []);

  // --- Todos (with undo support) ---
  const addTodo = useCallback(async (weekStart: string, text: string, deadline?: string) => {
    const tempId = `temp-${Date.now()}`;
    const maxPosition = todosRef.current.reduce((max, t) => Math.max(max, t.position ?? 0), 0);
    const tempTodo: Todo = { id: tempId, weekStart, text, completed: false, deadline, position: maxPosition + 1 };

    setTodos(prev => resortAndPersist([...prev, tempTodo]));

    try {
      const newTodo = await createTodo({ weekStart, text, completed: false, deadline, position: maxPosition + 1 });
      if (newTodo) {
        const todoWithFlag = { ...newTodo, isNew: true };
        setTodos(prev => resortAndPersist(prev.map(t => t.id === tempId ? todoWithFlag : t)));
        recordAction({
          category: 'todo',
          type: 'CREATE',
          todo: newTodo,
          description: `투두 추가: ${newTodo.text}`,
        });
        return newTodo;
      } else {
        console.warn("Create todo failed (null), preserving temp item");
        return null;
      }
    } catch (e) {
      console.error("Add Todo Exception", e);
      return null;
    }
  }, [setTodos, recordAction, resortAndPersist]);

  const toggleTodo = useCallback(async (todoId: string) => {
    const oldTodo = todosRef.current.find(t => t.id === todoId);

    setTodos(prev => {
      const todo = prev.find(t => t.id === todoId);
      if (!todo) return prev;
      const completed = !todo.completed;
      apiUpdateTodo(todoId, { completed });
      const updated = prev.map(t => t.id === todoId ? { ...t, completed } : t);
      return resortAndPersist(updated);
    });

    if (oldTodo) {
      recordAction({
        category: 'todo',
        type: 'TOGGLE',
        todo: { ...oldTodo, completed: !oldTodo.completed },
        prevTodo: oldTodo,
        description: `투두 토글: ${oldTodo.text}`,
      });
    }
  }, [setTodos, recordAction, resortAndPersist]);

  const updateTodo = useCallback(async (todoId: string, text: string, deadline?: string) => {
    const oldTodo = todosRef.current.find(t => t.id === todoId);
    const updates: any = { text };
    if (deadline !== undefined) updates.deadline = deadline;
    const updated = await apiUpdateTodo(todoId, updates);
    if (updated) {
      // deadline 변경 시 재정렬 적용
      setTodos(prev => resortAndPersist(prev.map(t => t.id === todoId ? updated : t)));
      if (oldTodo) {
        recordAction({
          category: 'todo',
          type: 'UPDATE',
          todo: updated,
          prevTodo: oldTodo,
          description: `투두 수정: ${updated.text}`,
        });
      }
    }
  }, [setTodos, recordAction, resortAndPersist]);

  const deleteTodo = useCallback(async (todoId: string) => {
    const todoToDelete = todosRef.current.find(t => t.id === todoId);
    const success = await apiDeleteTodo(todoId);
    if (success) {
      setTodos(prev => prev.filter(t => t.id !== todoId));
      if (todoToDelete) {
        recordAction({
          category: 'todo',
          type: 'DELETE',
          todo: todoToDelete,
          description: `투두 삭제: ${todoToDelete.text}`,
        });
      }
    }
    return success;
  }, [setTodos, recordAction]);

  // --- Undo/Redo Handlers for Routine ---
  useEffect(() => {
    registerCategoryHandlers(
      'routine',
      async (action: HistoryAction) => {
        // UNDO
        if (action.type === 'CREATE' && action.routine) {
          await apiDeleteRoutine(action.routine.id);
          setRoutines(prev => prev.filter(r => r.id !== action.routine!.id));
        } else if (action.type === 'DELETE' && action.routine) {
          const restored = await createRoutine({
            name: action.routine.name,
            icon: action.routine.icon,
            color: action.routine.color,
            days: action.routine.days,
          });
          if (restored) {
            setRoutines(prev => [...prev, restored]);
            action.routine = { ...action.routine, id: restored.id };
          }
        } else if (action.type === 'UPDATE' && action.prevRoutine) {
          const { id, ...prevData } = action.prevRoutine;
          const reverted = await apiUpdateRoutine(id, prevData);
          if (reverted) {
            setRoutines(prev => prev.map(r => r.id === id ? reverted : r));
          }
        }
      },
      async (action: HistoryAction) => {
        // REDO
        if (action.type === 'CREATE' && action.routine) {
          const restored = await createRoutine({
            name: action.routine.name,
            icon: action.routine.icon,
            color: action.routine.color,
            days: action.routine.days,
          });
          if (restored) {
            setRoutines(prev => [...prev, restored]);
            action.routine = { ...action.routine, id: restored.id };
          }
        } else if (action.type === 'DELETE' && action.routine) {
          await apiDeleteRoutine(action.routine.id);
          setRoutines(prev => prev.filter(r => r.id !== action.routine!.id));
        } else if (action.type === 'UPDATE' && action.routine) {
          const { id, ...newData } = action.routine;
          const reApplied = await apiUpdateRoutine(id, newData);
          if (reApplied) {
            setRoutines(prev => prev.map(r => r.id === id ? reApplied : r));
          }
        }
      }
    );
  }, [registerCategoryHandlers, setRoutines]);

  // --- Undo/Redo Handlers for Todo ---
  useEffect(() => {
    registerCategoryHandlers(
      'todo',
      async (action: HistoryAction) => {
        // UNDO
        if (action.type === 'CREATE' && action.todo) {
          await apiDeleteTodo(action.todo.id);
          setTodos(prev => prev.filter(t => t.id !== action.todo!.id));
        } else if (action.type === 'DELETE' && action.todo) {
          const restored = await createTodo({
            weekStart: action.todo.weekStart,
            text: action.todo.text,
            completed: action.todo.completed,
            deadline: action.todo.deadline,
          });
          if (restored) {
            setTodos(prev => [...prev, restored]);
            action.todo = { ...action.todo, id: restored.id };
          }
        } else if (action.type === 'UPDATE' && action.prevTodo) {
          const updates: any = { text: action.prevTodo.text };
          if (action.prevTodo.deadline !== undefined) updates.deadline = action.prevTodo.deadline;
          const reverted = await apiUpdateTodo(action.prevTodo.id, updates);
          if (reverted) {
            setTodos(prev => prev.map(t => t.id === action.prevTodo!.id ? reverted : t));
          }
        } else if (action.type === 'TOGGLE' && action.prevTodo) {
          const todoId = action.prevTodo.id;
          await apiUpdateTodo(todoId, { completed: action.prevTodo.completed });
          setTodos(prev => prev.map(t =>
            t.id === todoId ? { ...t, completed: action.prevTodo!.completed } : t
          ));
        }
      },
      async (action: HistoryAction) => {
        // REDO
        if (action.type === 'CREATE' && action.todo) {
          const restored = await createTodo({
            weekStart: action.todo.weekStart,
            text: action.todo.text,
            completed: action.todo.completed,
            deadline: action.todo.deadline,
          });
          if (restored) {
            setTodos(prev => [...prev, restored]);
            action.todo = { ...action.todo, id: restored.id };
          }
        } else if (action.type === 'DELETE' && action.todo) {
          await apiDeleteTodo(action.todo.id);
          setTodos(prev => prev.filter(t => t.id !== action.todo!.id));
        } else if (action.type === 'UPDATE' && action.todo) {
          const updates: any = { text: action.todo.text };
          if (action.todo.deadline !== undefined) updates.deadline = action.todo.deadline;
          const reApplied = await apiUpdateTodo(action.todo.id, updates);
          if (reApplied) {
            setTodos(prev => prev.map(t => t.id === action.todo!.id ? reApplied : t));
          }
        } else if (action.type === 'TOGGLE' && action.todo) {
          const todoId = action.todo.id;
          await apiUpdateTodo(todoId, { completed: action.todo.completed });
          setTodos(prev => prev.map(t =>
            t.id === todoId ? { ...t, completed: action.todo!.completed } : t
          ));
        }
      }
    );
  }, [registerCategoryHandlers, setTodos]);


  // --- Diary ---
  const fetchDiary = useCallback(async (date: string) => {
    if (diaryEntries[date]) return diaryEntries[date];
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
    events, routines, routineCompletions, todos, diaryEntries,
    addEvent, deleteEvent, updateEvent, deleteEvents,
    addRoutine, deleteRoutine, updateRoutine, toggleRoutine,
    addTodo, toggleTodo, updateTodo, deleteTodo, reorderTodos: reorderWeekTodos,
    fetchDiary, saveDiary, deleteDiary,
    recordAction, registerCategoryHandlers, canUndo, canRedo,
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
