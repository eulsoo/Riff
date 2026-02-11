
import { useState, useRef, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import {
  Event, Routine, RoutineCompletion, Todo, DiaryEntry, DayDefinition
} from '../types';
import {
  fetchEvents, fetchRoutines, fetchRoutineCompletions,
  fetchTodos, fetchDayDefinitions, fetchDiaryEntriesByRange,
  updateTodo
} from '../services/api';
import { getCacheKey, readCache, writeCache } from '../lib/cache';

// 타입 정의 이동이 필요하지만, 일단 App.tsx에서 가져옴
// 실제로는 types.ts로 분리하는 것이 Best Practice

export const useAppData = (
  session: Session | null,
  pastWeeks: number,
  futureWeeks: number,
  weekOrder: 'mon' | 'sun',
  getWeekStartForDate: (date: Date) => Date,
  getCurrentTodoWeekStart: () => string,
  formatLocalDate: (date: Date) => string
) => {
  const [events, setEvents] = useState<Event[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineCompletions, setRoutineCompletions] = useState<RoutineCompletion[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [dayDefinitions, setDayDefinitions] = useState<Record<string, string>>({});
  const [diaryEntries, setDiaryEntries] = useState<Record<string, DiaryEntry>>({});

  // 삭제된 이벤트 ID 추적 (loadData 병합 시 제외하기 위함)
  const deletedEventIdsRef = useRef<Set<string>>(new Set());

  const loadDataInFlightRef = useRef(false);
  const lastLoadSessionRef = useRef<string | null>(null);
  const lastLoadAtRef = useRef<number>(0);
  const lastLoadRangeRef = useRef<{ startDate: string; endDate: string } | null>(null);

  const getEventRange = useCallback(() => {
    const currentWeekStart = getWeekStartForDate(new Date());
    const firstWeekStart = new Date(currentWeekStart);
    const bufferWeeks = 4;
    firstWeekStart.setDate(firstWeekStart.getDate() - (pastWeeks + bufferWeeks) * 7);

    const lastWeekStart = new Date(currentWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() + (futureWeeks + bufferWeeks) * 7);

    const startDate = formatLocalDate(firstWeekStart);
    const lastDate = new Date(lastWeekStart);
    lastDate.setDate(lastDate.getDate() + 6);
    const endDate = formatLocalDate(lastDate);

    return { startDate, endDate };
  }, [getWeekStartForDate, pastWeeks, futureWeeks, formatLocalDate]);

  const rolloverTodosToCurrentWeek = useCallback(async (todosData: Todo[]) => {
    const currentTodoWeekStart = getCurrentTodoWeekStart();
    const toMove = todosData.filter(todo => !todo.completed && todo.weekStart < currentTodoWeekStart);

    if (toMove.length === 0) {
      return todosData;
    }

    const updatedTodos = await Promise.all(
      toMove.map(todo => updateTodo(todo.id, { weekStart: currentTodoWeekStart }))
    );
    const updatedById = new Map(
      updatedTodos.filter((todo): todo is Todo => Boolean(todo)).map(todo => [todo.id, todo])
    );

    return todosData.map(todo => updatedById.get(todo.id) ?? todo);
  }, [getCurrentTodoWeekStart]);

  const loadData = useCallback(async (force: boolean = false) => {
    if (!session) return;
    if (loadDataInFlightRef.current) return;
    const sessionId = session.user?.id || null;
    const now = Date.now();
    
    // Check if range changed
    const currentRange = getEventRange();
    const rangeChanged = !lastLoadRangeRef.current || 
      lastLoadRangeRef.current.startDate !== currentRange.startDate || 
      lastLoadRangeRef.current.endDate !== currentRange.endDate;

    // Bypass throttle if force=true OR range changed
    if (!force && !rangeChanged && sessionId && lastLoadSessionRef.current === sessionId && (now - lastLoadAtRef.current) < 1500) {
      return;
    }
    
    loadDataInFlightRef.current = true;
    try {
      const startAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const cacheKey = getCacheKey(session.user?.id, 'core');
      const cacheTtlMs = 5 * 60 * 1000;

      if (cacheKey) {
        const cached = readCache<{
          events: Event[];
          routines: Routine[];
          routineCompletions: RoutineCompletion[];
          todos: Todo[];
          dayDefinitions: Record<string, string>;
        }>(cacheKey, cacheTtlMs);

        // Only use cache if range matches or we aren't forcing a range update? 
        // Actually, mixing cache with new fetch logic is tricky. 
        // For simplicity, we hydrate from cache but still fall through to network if range changed.
        if (cached) {
          // 캐시 복원 시에도 로컬 이벤트 유지 (단, 삭제된 이벤트는 제외)
          setEvents(prev => {
            const cachedIds = new Set((cached.events || []).map(e => e.id));
            const deletedIds = deletedEventIdsRef.current;
            const localOnly = prev.filter(e => !cachedIds.has(e.id) && !deletedIds.has(e.id));
            const filteredCache = (cached.events || []).filter(e => !deletedIds.has(e.id));
            return [...filteredCache, ...localOnly];
          });
          setRoutines(cached.routines || []);
          setRoutineCompletions(cached.routineCompletions || []);
          setTodos(cached.todos || []);
          setDayDefinitions(cached.dayDefinitions || {});
          const endAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
          console.log(`cache:core hydrate ${Math.round(endAt - startAt)} ms`);
        }
      }

      const networkStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
      // Use the range we calculated earlier
      const { startDate, endDate } = currentRange;
      
      const [eventsData, routinesData, completionsData, todosData, dayDefinitionsData] = await Promise.all([
        fetchEvents(startDate, endDate),
        fetchRoutines(),
        fetchRoutineCompletions(),
        fetchTodos(),
        fetchDayDefinitions(),
      ]);
      
      // 서버 데이터와 로컬 상태 병합
      // - 서버에서 가져온 범위 내 이벤트: 서버 데이터 사용
      // - 서버 범위 밖의 로컬 이벤트: 유지 (스크롤 시 사라지지 않도록)
      // - 삭제된 이벤트: 제외
      const deletedIds = deletedEventIdsRef.current;
      setEvents(prev => {
        const serverIds = new Set(eventsData.map(e => e.id));
        // 서버 범위에 없고, 삭제되지 않은 로컬 이벤트 유지
        const localOnly = prev.filter(e => !serverIds.has(e.id) && !deletedIds.has(e.id));
        // 서버 데이터 + 범위 밖 로컬 이벤트 (삭제된 것 제외)
        return [...eventsData.filter(e => !deletedIds.has(e.id)), ...localOnly];
      });
      
      // 서버에서 성공적으로 데이터를 가져왔으므로 삭제 추적 ID 클리어
      deletedEventIdsRef.current.clear();
      
      setRoutines(routinesData);
      setRoutineCompletions(completionsData);
      
      const rolledTodos = await rolloverTodosToCurrentWeek(todosData);
      setTodos(rolledTodos);
      
      const dayDefinitionMap = (dayDefinitionsData || []).reduce((acc: Record<string, string>, item) => {
        acc[item.date] = item.text || '';
        return acc;
      }, {});
      setDayDefinitions(dayDefinitionMap);
      
      const networkEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
      console.log(`network:core load ${Math.round(networkEnd - networkStart)} ms`);

      if (cacheKey) {
        writeCache(cacheKey, {
          events: eventsData,
          routines: routinesData,
          routineCompletions: completionsData,
          todos: rolledTodos,
          dayDefinitions: dayDefinitionMap,
        });
      }
      lastLoadSessionRef.current = sessionId;
      lastLoadAtRef.current = Date.now();
      lastLoadRangeRef.current = currentRange; // Update last loaded range
    } finally {
      loadDataInFlightRef.current = false;
    }
  }, [session, getEventRange, rolloverTodosToCurrentWeek]);

  // 삭제된 이벤트 ID를 추적 (loadData 시 복원 방지)
  const markEventAsDeleted = useCallback((eventId: string) => {
    deletedEventIdsRef.current.add(eventId);
  }, []);

  const markEventsAsDeleted = useCallback((eventIds: string[]) => {
    eventIds.forEach(id => deletedEventIdsRef.current.add(id));
  }, []);

  return {
    events, setEvents,
    routines, setRoutines,
    routineCompletions, setRoutineCompletions,
    todos, setTodos,
    dayDefinitions, setDayDefinitions,
    diaryEntries, setDiaryEntries,
    loadData,
    markEventAsDeleted,
    markEventsAsDeleted
  };
};
