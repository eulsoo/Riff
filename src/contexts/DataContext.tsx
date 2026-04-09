import { createContext, useContext, ReactNode, useCallback, useRef, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
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
  upsertEvent, deleteEventByCaldavUid, bulkUpsertGoogleEvents, bulkDeleteEventsByCaldavUids, CalendarMetadata,
  fetchEmotionEntriesByRange, upsertEmotionEntry, deleteEmotionEntry,
} from '../services/api';
import {
  getGoogleProviderToken,
  fetchGoogleEvents,
  fetchGoogleCalendarList,
  mapGoogleEventToRiff,
  loadGoogleSyncTokens,
  clearGoogleSyncToken,
  loadGoogleLastSyncTimes,
  saveGoogleLastSyncTimes,
  registerGoogleWatchChannel,
} from '../lib/googleCalendar';

// localStorage key for selected google calendar IDs
const GOOGLE_SELECTED_CALENDARS_KEY = 'googleSelectedCalendarIds';
const GOOGLE_CALENDARS_META_KEY = 'googleCalendarsMeta';

interface DataContextType {
  // State
  events: Event[];
  routines: Routine[];
  routineCompletions: import('../types').RoutineCompletion[];
  todos: Todo[];
  diaryEntries: Record<string, DiaryEntry>;
  emotions: Record<string, string>;

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

  // Actions - Emotions
  setEmotion: (date: string, emotion: string) => void;

  // Undo/Redo
  recordAction: (action: HistoryAction) => void;
  registerCategoryHandlers: (
    category: ActionCategory,
    onUndo: (action: HistoryAction) => Promise<void>,
    onRedo: (action: HistoryAction) => Promise<void>
  ) => void;
  canUndo: boolean;
  canRedo: boolean;

  // Google Calendar
  googleCalendars: CalendarMetadata[];
  hasGoogleProvider: boolean;
  isSyncingGoogle: boolean;
  isGoogleTokenExpired: boolean;
  clearGoogleTokenExpiredFlag: () => void;
  syncGoogleCalendar: (selectedMeta: CalendarMetadata[]) => Promise<void>;
  removeGoogleCalendar: (calendarId: string) => void;
  selectedGoogleCalendarIds: string[];
  toggleGoogleCalendarSelected: (calendarId: string) => void;

  // Data Loading
  loadData: (force?: boolean, excludeCalendarUrls?: string[]) => Promise<void>;

  // External Calendar Deletion (Google 404)
  externallyDeletedCalendars: Array<{ calId: string; createdFromApp: boolean }>;
  clearExternallyDeletedCalendars: () => void;
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
  formatLocalDate,
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

  const [emotions, setEmotions] = useState<Record<string, string>>({});

  // ── Google Calendar state ──────────────────────────────────
  const [googleCalendars, setGoogleCalendars] = useState<CalendarMetadata[]>(() => {
    try {
      const raw = localStorage.getItem(GOOGLE_CALENDARS_META_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [selectedGoogleCalendarIds, setSelectedGoogleCalendarIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(GOOGLE_SELECTED_CALENDARS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [isSyncingGoogle, setIsSyncingGoogle] = useState(false);
  const [externallyDeletedCalendars, setExternallyDeletedCalendars] = useState<Array<{ calId: string; createdFromApp: boolean }>>([]);
  const clearExternallyDeletedCalendars = useCallback(() => setExternallyDeletedCalendars([]), []);
  const [isGoogleTokenExpired, setIsGoogleTokenExpired] = useState(
    () => localStorage.getItem('googleTokenExpired') === 'true'
  );
  const googleSyncTokensRef = useRef<Record<string, string>>(loadGoogleSyncTokens());
  const selectedGoogleIdsRef = useRef(selectedGoogleCalendarIds);
  selectedGoogleIdsRef.current = selectedGoogleCalendarIds;
  const googleCalendarsRef = useRef(googleCalendars);
  googleCalendarsRef.current = googleCalendars;

  const persistGoogleCalendars = useCallback((meta: CalendarMetadata[]) => {
    setGoogleCalendars(meta);
    googleCalendarsRef.current = meta;
    localStorage.setItem(GOOGLE_CALENDARS_META_KEY, JSON.stringify(meta));
  }, []);

  const persistSelectedGoogleCalendarIds = useCallback((ids: string[]) => {
    setSelectedGoogleCalendarIds(ids);
    selectedGoogleIdsRef.current = ids;
    localStorage.setItem(GOOGLE_SELECTED_CALENDARS_KEY, JSON.stringify(ids));
  }, []);

  const clearGoogleTokenExpiredFlag = useCallback(() => {
    localStorage.removeItem('googleTokenExpired');
    setIsGoogleTokenExpired(false);
  }, []);

  useEffect(() => {
    // 기존 localStorage 캐시 제거 (DB 단일 소스로 전환)
    window.localStorage.removeItem('user_emotions');

    // DB에서 최근 1년치 + 내년까지 감정 데이터 fetch
    const now = new Date();
    const startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = new Date(now.getFullYear() + 1, 11, 31).toISOString().split('T')[0];

    fetchEmotionEntriesByRange(startStr, endStr).then(dbEmotions => {
      setEmotions(dbEmotions);
    }).catch(err => {
      console.warn('[Emotion] DB fetch 실패:', err);
    });
  }, []);

  const setEmotionStr = useCallback((date: string, emotion: string) => {
    setEmotions((prev: Record<string, string>) => {
      const next = { ...prev };
      if (emotion) {
        next[date] = emotion;
        upsertEmotionEntry(date, emotion).catch(err =>
          console.error('[Emotion] DB 저장 실패:', err)
        );
      } else {
        delete next[date];
        deleteEmotionEntry(date).catch(err =>
          console.error('[Emotion] DB 삭제 실패:', err)
        );
      }
      return next;
    });
  }, []);

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

  // ── Google Calendar sync ────────────────────────────────────
  // Called by GoogleSyncModal after user selects calendars and clicks sync,
  // or called without arguments during auto-sync (tab focus).
  const syncGoogleCalendar = useCallback(async (selectedMeta?: CalendarMetadata[]) => {
    const token = await getGoogleProviderToken();

    if (!token) {
      // provider_token 만료 (Supabase JWT 갱신 후 소멸되는 알려진 한계)
      // 자동 동기화만 있는 경우(selectedMeta 없음): Google을 연동한 적 있는 유저면 플래그 저장
      // googleCalendarsRef 대신 session.app_metadata.providers로 판단 —
      // Riff→Google(createdFromApp) 캘린더만 있는 경우에도 올바르게 감지하기 위함
      if (!selectedMeta) {
        const hasGoogleProvider =
          session?.user?.app_metadata?.providers?.includes('google') ||
          session?.user?.app_metadata?.provider === 'google';
        // Apple 로그인 유저가 Google OAuth 독립 연동을 완료한 경우도 포함
        const isGoogleOAuthConnected = localStorage.getItem('googleOAuthConnected') === 'true';
        if (hasGoogleProvider || isGoogleOAuthConnected) {
          localStorage.setItem('googleTokenExpired', 'true');
          setIsGoogleTokenExpired(true);
          console.warn('[Google] provider_token이 만료되었습니다. Google 섹션에서 재연결이 필요합니다.');
        }
      }
      return;
    }

    // 토큰이 다시 유효해지면 만료 플래그 제거
    clearGoogleTokenExpiredFlag();

    setIsSyncingGoogle(true);
    try {
      let metaToSync = selectedMeta;

      // 1. If explicit meta provided (from Modal), persist it.
      if (selectedMeta) {
        persistGoogleCalendars(selectedMeta);
        const allIds = selectedMeta.map(m => m.googleCalendarId!).filter(Boolean);
        persistSelectedGoogleCalendarIds(allIds);
      } else {
        // Auto-sync mode: use current state
        metaToSync = googleCalendarsRef.current.filter(c => selectedGoogleIdsRef.current.includes(c.googleCalendarId!));

        // Google에서 캘린더 이름이 바뀌었는지 확인 후 갱신 (Google → Riff 이름 동기화)
        try {
          const calendarList = await fetchGoogleCalendarList(token);
          const nameMap = new Map(calendarList.map(cal => [cal.id, cal.summary]));

          let hasNameChange = false;
          const updatedMeta = googleCalendarsRef.current.map((cal: CalendarMetadata) => {
            const latestName: string | undefined = cal.googleCalendarId ? nameMap.get(cal.googleCalendarId) : undefined;
            if (latestName && latestName !== cal.displayName) {
              hasNameChange = true;
              return { ...cal, displayName: latestName };
            }
            return cal;
          });

          if (hasNameChange) {
            persistGoogleCalendars(updatedMeta);
            metaToSync = updatedMeta.filter(c => selectedGoogleIdsRef.current.includes(c.googleCalendarId!));
            console.log('[Google] 캘린더 이름 변경 감지 → Riff 업데이트 완료');
          }
        } catch (e) {
          // 이름 갱신 실패는 무시 (이벤트 동기화는 계속 진행)
          console.warn('[Google] 캘린더 목록 갱신 실패:', e);
        }
      }

      if (!metaToSync || metaToSync.length === 0) {
        setIsSyncingGoogle(false);
        return;
      }

      // 2. Fetch events for each selected calendar and upsert into Supabase
      const now = new Date();
      const timeMin = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString();
      const timeMax = new Date(now.getFullYear(), now.getMonth() + 4, 0).toISOString();

      // 삭제된 caldav uid 수집 (loadData 이후 state 필터링에 사용)
      const deletedByCalendar: { calId: string; uids: string[] }[] = [];

      for (const calMeta of metaToSync) {
        const calId = calMeta.googleCalendarId!;
        if (!calId) continue;
        const color = calMeta.color;
        const lastSyncTime = lastSyncTimesRef.current[calId]; // 이전 sync 시각 (있으면 증분)

        try {
          const { events: gEvents } = await fetchGoogleEvents(token, calId, {
            timeMin,
            timeMax,
            // lastSyncTime이 있으면 변경분만, 없으면 전체 fetch
            // updatedMin + singleEvents=true 조합으로 nextSyncToken 미수신 문제 우회
            updatedMin: lastSyncTime,
          });

          // N+1 방지: 개별 await 대신 bulk upsert/delete로 단일 DB 왕복
          const toUpsert: Array<ReturnType<typeof mapGoogleEventToRiff> & object> = [];
          const toDelete: string[] = [];

          for (const gEv of gEvents) {
            if (gEv.status === 'cancelled') {
              if (gEv.id) toDelete.push(gEv.id);
            } else {
              const mapped = mapGoogleEventToRiff(gEv, calId, color);
              if (mapped) toUpsert.push(mapped);
            }
          }

          console.log(`[Google Sync] cal=${calId} updatedMin=${lastSyncTime ?? 'full'} total=${gEvents.length} upsert=${toUpsert.length} delete=${toDelete.length}`, toDelete);

          await Promise.all([
            bulkUpsertGoogleEvents(toUpsert as any),
            bulkDeleteEventsByCaldavUids(toDelete, `google:${calId}`),
          ]);

          if (toDelete.length > 0) {
            deletedByCalendar.push({ calId, uids: toDelete });
          }

          // sync 성공 시각 저장 → 다음 sync에서 updatedMin으로 활용
          lastSyncTimesRef.current[calId] = new Date().toISOString();
          saveGoogleLastSyncTimes(lastSyncTimesRef.current);

          // Watch 채널 등록 (백그라운드, 실패해도 폴링으로 fallback)
          void registerGoogleWatchChannel(calId, color);
        } catch (err: any) {
          if (err?.message === 'SYNC_TOKEN_INVALID') {
            clearGoogleSyncToken(calId);
            delete googleSyncTokensRef.current[calId];
          } else if (err?.message?.includes('404')) {
            // Google에서 캘린더가 외부 삭제됨
            // 이중 동기화(caldavSyncUrl 보유)된 캘린더도 함께 처리 정보로 전달
            setExternallyDeletedCalendars(prev => [...prev, {
              calId,
              createdFromApp: calMeta.createdFromApp ?? false,
            }]);
          } else {
            console.error(`Google sync error for calendar ${calId}:`, err);
          }
        }
      }

      // 3. Reload local events state (force=true로 캐시/쓰로틀 무시 → 즉시 반영)
      await loadData(true);

      // loadData 이후 state 필터링: mergeEventsWithLocal이 완료된 뒤 삭제 이벤트 제거
      // (loadData 전에 하면 React 배칭으로 mergeEventsWithLocal의 prev에 여전히 삭제 이벤트가 남음)
      if (deletedByCalendar.length > 0) {
        setEvents(prev => {
          let next = prev;
          for (const { calId, uids } of deletedByCalendar) {
            const deleteSet = new Set(uids);
            const calUrl = `google:${calId}`;
            next = next.filter(e => !(e.caldavUid && deleteSet.has(e.caldavUid) && e.calendarUrl === calUrl));
          }
          return next;
        });
      }
    } catch (err) {
      console.error('syncGoogleCalendar failed:', err);
    } finally {
      setIsSyncingGoogle(false);
    }
  }, [loadData, persistGoogleCalendars, persistSelectedGoogleCalendarIds, clearGoogleTokenExpiredFlag, session]);


  const removeGoogleCalendar = useCallback((calendarId: string) => {
    setGoogleCalendars(prev => {
      const next = prev.filter(c => c.googleCalendarId !== calendarId);
      localStorage.setItem(GOOGLE_CALENDARS_META_KEY, JSON.stringify(next)); // 새로고침 시 복원 방지
      return next;
    });
    setSelectedGoogleCalendarIds(prev => {
      const next = prev.filter(id => id !== calendarId);
      localStorage.setItem(GOOGLE_SELECTED_CALENDARS_KEY, JSON.stringify(next));
      return next;
    });
    clearGoogleSyncToken(calendarId);
  }, []);

  const toggleGoogleCalendarSelected = useCallback((calendarId: string) => {
    setSelectedGoogleCalendarIds(prev => {
      const next = prev.includes(calendarId)
        ? prev.filter(id => id !== calendarId)
        : [...prev, calendarId];
      localStorage.setItem(GOOGLE_SELECTED_CALENDARS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // 캘린더별 마지막 sync 시각 (updatedMin 증분 동기화용)
  const lastSyncTimesRef = useRef<Record<string, string>>(loadGoogleLastSyncTimes());

  // Re-sync on tab focus & periodically (5 minutes)
  // lastSyncAtRef: 60초 내 중복 발화(타이머 + 탭 포커스 동시 발생) 차단
  const lastSyncAtRef = useRef<number>(0);
  // Realtime useEffect에서 최신 syncGoogleCalendar를 안정적으로 참조하기 위한 ref
  const syncGoogleCalendarRef = useRef(syncGoogleCalendar);
  useEffect(() => { syncGoogleCalendarRef.current = syncGoogleCalendar; }, [syncGoogleCalendar]);

  useEffect(() => {
    const triggerSync = () => {
      if (selectedGoogleIdsRef.current.length === 0) return;
      const now = Date.now();
      if (now - lastSyncAtRef.current < 60_000) return; // 60초 내 중복 방지
      lastSyncAtRef.current = now;
      syncGoogleCalendar();
    };

    // 1. Tab Focus event
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') triggerSync();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // 2. Periodic background polling (5분 — 60초에서 변경, egress 절약)
    const intervalId = setInterval(triggerSync, 5 * 60 * 1000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(intervalId);
    };
  }, [syncGoogleCalendar]);

  // Supabase Realtime — 별도 useEffect (채널을 마운트 1회만 생성)
  // syncGoogleCalendar와 같은 useEffect에 두면 함수 재생성마다 채널이
  // teardown/re-create를 반복해 CHANNEL_ERROR가 발생하므로 분리
  useEffect(() => {
    // events / calendar_metadata 제외: iCloud/Google 동기화가 직접 관리.
    // Realtime에서 events catch-up이 오면 외부 동기화가 반복 트리거되는 루프 방지.
    // emotion·diary·todo·routines는 앱↔웹 간 즉시 반영이 목적.
    const triggerRealtimeSync = () => {
      if (selectedGoogleIdsRef.current.length === 0) return;
      const now = Date.now();
      if (now - lastSyncAtRef.current < 60_000) return;
      lastSyncAtRef.current = now;
      syncGoogleCalendarRef.current();
    };

    const realtimeChannel = supabase
      .channel('riff-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emotion_entries' },
        () => triggerRealtimeSync())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'routine_completions' },
        () => triggerRealtimeSync())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' },
        () => triggerRealtimeSync())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'diary_entries' },
        () => triggerRealtimeSync())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'routines' },
        () => triggerRealtimeSync())
      .subscribe();

    return () => {
      clearTimeout(eventsDebounce);
      supabase.removeChannel(realtimeChannel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Google Webhook Broadcast 구독 — 웹훅 수신 시 즉시 loadData
  // events 테이블 Realtime 구독 없이 별도 Broadcast 채널로 통지받아 sync 루프 방지
  useEffect(() => {
    if (!session?.user?.id || selectedGoogleCalendarIds.length === 0) return;

    let broadcastDebounce: ReturnType<typeof setTimeout>;

    const webhookChannel = supabase
      .channel(`google-webhook-${session.user.id}`)
      .on('broadcast', { event: 'sync-complete' }, (msg) => {
        clearTimeout(broadcastDebounce);
        broadcastDebounce = setTimeout(() => {
          // lastSyncTimesRef도 갱신하여 다음 폴링의 중복 fetch 최소화
          const calendarId = msg.payload?.calendarId as string | undefined;
          if (calendarId) {
            lastSyncTimesRef.current[calendarId] = new Date().toISOString();
            saveGoogleLastSyncTimes(lastSyncTimesRef.current);
          }
          loadData(true);
        }, 300);
      })
      .subscribe();

    return () => {
      clearTimeout(broadcastDebounce);
      supabase.removeChannel(webhookChannel);
    };
  }, [session?.user?.id, selectedGoogleCalendarIds.length, loadData]); // eslint-disable-line react-hooks/exhaustive-deps




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
      setRoutines(prev => prev.map(r => r.id === routineId ? { ...r, deletedAt: new Date().toISOString() } : r));
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
    // deadline이 undefined이면 null로 설정 (DB에서 삭제)
    updates.deadline = deadline ?? null;
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
          const restored = await apiUpdateRoutine(action.routine.id, { deleted_at: null } as any);
          if (restored) {
            setRoutines(prev => prev.map(r => r.id === action.routine!.id ? restored : r));
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
          setRoutines(prev => prev.map(r => r.id === action.routine!.id ? { ...r, deletedAt: new Date().toISOString() } : r));
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
    const req = fetchDiaryEntry(date);
    diaryInFlightRef.current[date] = req;
    const entry = await req;
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
    events, routines, routineCompletions, todos, diaryEntries, emotions,
    addEvent, deleteEvent, updateEvent, deleteEvents,
    addRoutine, deleteRoutine, updateRoutine, toggleRoutine,
    addTodo, toggleTodo, updateTodo, deleteTodo, reorderTodos: reorderWeekTodos,
    fetchDiary, saveDiary, deleteDiary, setEmotion: setEmotionStr,
    recordAction, registerCategoryHandlers, canUndo, canRedo,
    loadData,
    // Google Calendar
    hasGoogleProvider: !!(session?.user?.app_metadata?.providers?.includes('google') || session?.user?.app_metadata?.provider === 'google'),
    googleCalendars, isSyncingGoogle, isGoogleTokenExpired, clearGoogleTokenExpiredFlag, syncGoogleCalendar,
    removeGoogleCalendar, selectedGoogleCalendarIds, toggleGoogleCalendarSelected,
    // External Calendar Deletion
    externallyDeletedCalendars, clearExternallyDeletedCalendars,
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
