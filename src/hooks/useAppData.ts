
import { useState, useRef, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import {
  Event, Routine, RoutineCompletion, Todo, DiaryEntry
} from '../types';
import {
  fetchEvents, fetchRoutines, fetchRoutineCompletions,
  fetchTodos, 
  updateTodo,
  updateTodoPositions,
  fetchDiaryEntriesByRange,
  normalizeCalendarUrl
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
  const buildExcludeCalendarSet = (excludeCalendarUrls?: string[]) =>
    excludeCalendarUrls?.length
      ? new Set(excludeCalendarUrls.flatMap(u => [u, normalizeCalendarUrl(u)].filter(Boolean)))
      : null;

  const mergeEventsWithLocal = (
    prev: Event[],
    eventsFromServer: Event[],
    deletedIds: Set<string>,
    excludeSet: Set<string> | null
  ) => {
    const serverIds = new Set(eventsFromServer.map(e => e.id));
    const isExcluded = (e: Event) =>
      excludeSet && e.calendarUrl && (excludeSet.has(e.calendarUrl) || excludeSet.has(normalizeCalendarUrl(e.calendarUrl) || ''));

    const localOnly = prev.filter(e =>
      !serverIds.has(e.id) && !deletedIds.has(e.id) && !isExcluded(e)
    );
    return [...eventsFromServer.filter(e => !deletedIds.has(e.id)), ...localOnly];
  };

  const mergeTodosWithLocal = (
    prev: Todo[],
    rolledTodos: Todo[]
  ) => {
    const tempAndNewTodos = prev.filter(t => t.id.startsWith('temp-') || t.isNew);
    const serverIds = new Set(rolledTodos.map(t => t.id));
    const keptTodos = tempAndNewTodos.filter(t => !serverIds.has(t.id));
    return [...rolledTodos, ...keptTodos];
  };

  const mergeDiaryEntriesWithLocal = (
    prev: Record<string, DiaryEntry>,
    diaryData: DiaryEntry[]
  ) => {
    const merged = { ...prev };
    for (const entry of diaryData) {
      const existing = merged[entry.date];
      if (!existing || (entry.updatedAt && existing.updatedAt && entry.updatedAt > existing.updatedAt)) {
        merged[entry.date] = entry;
      }
    }
    return merged;
  };

  const [events, setEvents] = useState<Event[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineCompletions, setRoutineCompletions] = useState<RoutineCompletion[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [diaryEntries, setDiaryEntries] = useState<Record<string, DiaryEntry>>({});

  // 삭제된 이벤트 ID 추적 (loadData 병합 시 제외하기 위함)
  const deletedEventIdsRef = useRef<Set<string>>(new Set());

  const loadDataInFlightRef = useRef(false);
  const pendingForceLoadRef = useRef(false); // force=true 호출이 진행 중 load에 막혔을 때 재시도용
  const pendingExcludeUrlsRef = useRef<string[] | undefined>(undefined); // 재시도 시 함께 전달할 excludeCalendarUrls
  const lastLoadSessionRef = useRef<string | null>(null);
  const lastLoadAtRef = useRef<number>(0);
  const lastLoadRangeRef = useRef<{ startDate: string; endDate: string } | null>(null);
  const hasHydratedFromCacheRef = useRef(false);

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

  // 중앙 정렬 함수: 완료(먼저) → 미완료(나중, deadline ASC → 없으면 맨 뒤)
  // 정렬 후 position 값 재할당
  const sortTodosGrouped = useCallback((todoList: Todo[]): Todo[] => {
    const completed = todoList.filter(t => t.completed);
    const uncompleted = todoList.filter(t => !t.completed);

    // 완료 그룹: position 순서 유지 (체크 순서 보존)
    completed.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));

    // 미완료 그룹: deadline이 PRIMARY (position 무시)
    uncompleted.sort((a, b) => {
      // 둘 다 deadline 없으면 position으로 (추가된 순서)
      if (!a.deadline && !b.deadline) return (a.position ?? 0) - (b.position ?? 0);
      if (!a.deadline) return 1;  // deadline 없는 것 맨 뒤
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });

    // position 재할당
    const sorted = [...completed, ...uncompleted];
    return sorted.map((t, idx) => ({ ...t, position: idx }));
  }, []);

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

  const loadData = useCallback(async (force: boolean = false, excludeCalendarUrls?: string[]) => {
    if (!session) return;
    if (loadDataInFlightRef.current) {
      if (force) {
        pendingForceLoadRef.current = true;
        // excludeCalendarUrls를 누적 저장 (기존 목록 + 새 목록 합산)
        if (excludeCalendarUrls?.length) {
          pendingExcludeUrlsRef.current = [
            ...(pendingExcludeUrlsRef.current ?? []),
            ...excludeCalendarUrls,
          ];
        }
      }
      return;
    }
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
        }>(cacheKey, cacheTtlMs);

        // Only use cache if range matches or we aren't forcing a range update? 
        // Actually, mixing cache with new fetch logic is tricky. 
        // For simplicity, we hydrate from cache but still fall through to network if range changed.
        if (cached && !hasHydratedFromCacheRef.current) {
          hasHydratedFromCacheRef.current = true;
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
          setTodos(prev => {
            const cachedTodos = cached.todos || [];
            const cachedIds = new Set(cachedTodos.map(t => t.id));
            // Preserve temp and isNew todos that aren't in the cache
            const localOnly = prev.filter(t =>
              !cachedIds.has(t.id) && (t.id.startsWith('temp-') || t.isNew)
            );
            
            let finalTodos = [...cachedTodos, ...localOnly];
            
            // position 기반 그룹 정렬 적용
            finalTodos = sortTodosGrouped(finalTodos);
            return finalTodos;
          });
          const endAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
          console.log(`cache:core hydrate ${Math.round(endAt - startAt)} ms`);
        }
      }

      const networkStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
      // Use the range we calculated earlier
      const { startDate, endDate } = currentRange;
      
      const [eventsData, routinesData, completionsData, todosData, diaryData] = await Promise.all([
        fetchEvents(startDate, endDate),
        fetchRoutines(),
        fetchRoutineCompletions(),
        fetchTodos(),
        fetchDiaryEntriesByRange(startDate, endDate),
      ]);

      
      // 서버 데이터와 로컬 상태 병합
      // - 서버에서 가져온 범위 내 이벤트: 서버 데이터 사용
      // - 서버 범위 밖의 로컬 이벤트: 유지 (스크롤 시 사라지지 않도록)
      // - 삭제된 이벤트: 제외
      // - 동기화 해제된 캘린더 이벤트: excludeCalendarUrls에 있으면 제외
      const deletedIds = deletedEventIdsRef.current;
      const excludeSet = buildExcludeCalendarSet(excludeCalendarUrls);
      setEvents(prev => mergeEventsWithLocal(prev, eventsData, deletedIds, excludeSet));
      
      // 서버에서 성공적으로 데이터를 가져왔으므로 삭제 추적 ID 클리어
      deletedEventIdsRef.current.clear();
      
      setRoutines(routinesData);
      setRoutineCompletions(completionsData);
      
      const rolledTodos = await rolloverTodosToCurrentWeek(todosData);
      setTodos(prev => sortTodosGrouped(mergeTodosWithLocal(prev, rolledTodos)));

      // Diary entries: merge server data with local cache
      // Preserve locally cached entries (from active editing) to avoid overwriting unsaved work
      if (diaryData.length > 0) {
        setDiaryEntries(prev => mergeDiaryEntriesWithLocal(prev, diaryData));
      }
      
      const networkEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
      console.log(`network:core load ${Math.round(networkEnd - networkStart)} ms`);

      if (cacheKey) {
        writeCache(cacheKey, {
          events: eventsData,
          routines: routinesData,
          routineCompletions: completionsData,
          todos: rolledTodos,
        });
      }
      lastLoadSessionRef.current = sessionId;
      lastLoadAtRef.current = Date.now();
      lastLoadRangeRef.current = currentRange; // Update last loaded range
    } finally {
      loadDataInFlightRef.current = false;
      if (pendingForceLoadRef.current) {
        pendingForceLoadRef.current = false;
        const pendingExclude = pendingExcludeUrlsRef.current;
        pendingExcludeUrlsRef.current = undefined;
        setTimeout(() => loadData(true, pendingExclude), 0);
      }
    }
  }, [session, getEventRange, rolloverTodosToCurrentWeek]);

  // 삭제된 이벤트 ID를 추적 (loadData 시 복원 방지)
  const markEventAsDeleted = useCallback((eventId: string) => {
    deletedEventIdsRef.current.add(eventId);
  }, []);


  const markEventsAsDeleted = useCallback((eventIds: string[]) => {
    eventIds.forEach(id => deletedEventIdsRef.current.add(id));
  }, []);

  const reorderWeekTodos = useCallback((_weekStart: string, newOrderedTodos: Todo[]) => {
    // position 값 할당
    const todosWithPositions = newOrderedTodos.map((t, idx) => ({ ...t, position: idx }));
    
    setTodos(prev => {
      const newIds = new Set(todosWithPositions.map(t => t.id));
      const otherTodos = prev.filter(t => !newIds.has(t.id));
      return [...otherTodos, ...todosWithPositions];
    });

    // DB에 position 저장 (비동기)
    const positionUpdates = todosWithPositions
      .filter(t => !t.id.startsWith('temp-'))
      .map(t => ({ id: t.id, position: t.position! }));
    if (positionUpdates.length > 0) {
      updateTodoPositions(positionUpdates);
    }
  }, []);

  return {
    events, setEvents,
    routines, setRoutines,
    routineCompletions, setRoutineCompletions,
    todos, setTodos,
    diaryEntries, setDiaryEntries,
    loadData,
    markEventAsDeleted,

    markEventsAsDeleted,
    reorderWeekTodos
  };
};
