import { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback, memo } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { Login } from './components/Login';
import { WeekCard } from './components/WeekCard';
import { AppHeader } from './components/AppHeader';
import { AppModals } from './components/AppModals';
import { ObserverWrapper } from './components/ObserverWrapper';
import { DiaryModal } from './components/DiaryModal';
import styles from './App.module.css';
import {
  fetchEvents, createEvent, deleteEvent, updateEvent,
  fetchRoutines, createRoutine, deleteRoutine,
  fetchRoutineCompletions, toggleRoutineCompletion,
  fetchTodos, createTodo, updateTodo, deleteTodo,
  fetchDiaryEntry, fetchDiaryEntriesByRange, upsertDiaryEntry, deleteDiaryEntry,
  fetchDayDefinitions, upsertDayDefinition, deleteDayDefinition,
  getCalDAVSyncSettings, updateLastSyncTime,
  deleteDuplicateEvents, getUserAvatar,
  getCalendarMetadata, CalendarMetadata, saveCalendarMetadata,
  normalizeCalendarUrl
} from './services/api';
import { syncSelectedCalendars, CalDAVConfig, getCalendars } from './services/caldav';
import { encryptData, decryptData } from './lib/crypto';
import { CalendarListPopup, CalendarToggleButton } from './components/CalendarListPopup';

export interface Event {
  id: string;
  date: string;
  title: string;
  memo?: string;
  startTime?: string;
  endTime?: string;
  color: string;
  calendarUrl?: string;
}

export interface Routine {
  id: string;
  name: string;
  icon: string;
  color: string;
  days: number[]; // 0=월, 1=화, 2=수, 3=목, 4=금, 5=토, 6=일
  createdAt?: string;
}

export interface RoutineCompletion {
  routineId: string;
  date: string;
  completed: boolean;
}

export interface Todo {
  id: string;
  weekStart: string; // 주의 시작 날짜
  text: string;
  completed: boolean;
}

export interface DiaryEntry {
  date: string;
  title: string;
  content: string;
  updatedAt?: string;
}

export interface DayDefinition {
  id: string;
  date: string;
  text: string;
}

export type WeekOrder = 'mon' | 'sun';

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function App() {
  const [events, setEvents] = useState<Event[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineCompletions, setRoutineCompletions] = useState<RoutineCompletion[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [dayDefinitions, setDayDefinitions] = useState<Record<string, string>>({});
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [weekOrder, setWeekOrder] = useState<WeekOrder>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('weekOrder') : null;
    return saved === 'sun' ? 'sun' : 'mon';
  });
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true); // 세션 확인 중
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null); // detail modal target
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]); // UI selection (multi)
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isRoutineModalOpen, setIsRoutineModalOpen] = useState(false);
  const [isCalDAVModalOpen, setIsCalDAVModalOpen] = useState(false);
  const [pastWeeks, setPastWeeks] = useState(() => {
    if (typeof window === 'undefined') return 8;
    const saved = window.localStorage.getItem('pastWeeks');
    return saved ? parseInt(saved, 10) : 8; // 기본값 8주
  });
  const [futureWeeks, setFutureWeeks] = useState(12);

  const [calendarMetadata, setCalendarMetadata] = useState<CalendarMetadata[]>([]);
  const [visibleCalendarUrlSet, setVisibleCalendarUrlSet] = useState<Set<string>>(new Set());
  const [isCalendarPopupOpen, setIsCalendarPopupOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState<{
    anchorId: string;
    align: 'left' | 'right';
  } | null>(null);

  const [draftEvent, setDraftEvent] = useState<Event | null>(null);
  const [modalSessionId, setModalSessionId] = useState<number>(0);
  const debouncedUpdateRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleDateClick = useCallback((date: string, anchorEl?: HTMLElement) => {
    setSelectedDate(date);
    const defaultColor = calendarMetadata.length > 0 ? calendarMetadata[0].color : '#3b82f6';
    const newDraft: Event = {
      id: 'draft-new',
      date: date,
      title: '새로운 일정',
      startTime: '09:00',
      endTime: '10:00',
      color: defaultColor,
      calendarUrl: calendarMetadata.length > 0 ? calendarMetadata[0].url : undefined,
    };
    setDraftEvent(newDraft);
    setSelectedEvent(null);
    setModalSessionId(prev => prev + 1); // 새 모달 세션 시작

    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      const isLeft = rect.left < window.innerWidth / 2;
      setPopupPosition({
        anchorId: `day-cell-${date}`,
        align: isLeft ? 'left' : 'right',
      });
    } else {
      setPopupPosition(null);
    }
    setIsEventModalOpen(true);
  }, []);

  const handleEventClick = useCallback((event: Event, multi: boolean) => {
    setSelectedEventIds(prev => {
      if (multi) {
        return prev.includes(event.id)
          ? prev.filter(id => id !== event.id)
          : [...prev, event.id];
      }
      return [event.id];
    });
  }, []);

  const handleUpdateDraft = useCallback((updates: Partial<Event>) => {
    setDraftEvent(prev => prev ? { ...prev, ...updates } : null);
  }, []);

  const handleEventDoubleClick = useCallback((event: Event, anchorEl?: HTMLElement) => {
    setSelectedEvent(event);
    setDraftEvent(null);
    setSelectedDate(event.date);
    setModalSessionId(prev => prev + 1); // 새 모달 세션 시작

    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      const isLeft = rect.left < window.innerWidth / 2;
      setPopupPosition({
        anchorId: `event-item-${event.id}`,
        align: isLeft ? 'left' : 'right',
      });
    } else {
      setPopupPosition(null);
    }
    setIsEventModalOpen(true);
  }, []);

  const handleToggleCalendarVisibility = useCallback((url: string) => {
    setVisibleCalendarUrlSet(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const getWeekStartForDate = useCallback((date: Date) => {
    const weekStart = new Date(date);
    const dayOfWeek = weekStart.getDay();
    const diff = weekOrder === 'sun'
      ? -dayOfWeek
      : (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    weekStart.setDate(weekStart.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }, [weekOrder]);

  // calendarMetadata의 URL 집합 (필터링 대상 확인용)
  const calendarUrlSet = useMemo(() =>
    new Set(calendarMetadata.map(c => c.url)),
    [calendarMetadata]
  );

  // 캘린더 메타데이터가 변경되면, 새로운 캘린더를 visible set에 자동으로 추가
  // (이전에 숨김 처리된 적이 없다면 기본적으로 보이게 함)
  useEffect(() => {
    if (calendarMetadata.length === 0) return;

    setVisibleCalendarUrlSet(prev => {
      let changed = false;
      const next = new Set(prev);

      calendarMetadata.forEach(cal => {
        // 아직 리스트에 없는 캘린더 URL이 있다면 추가
        if (!next.has(cal.url)) {
          next.add(cal.url);
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [calendarMetadata]);

  const filteredEvents = useMemo(() => {
    // 캘린더 메타데이터가 없으면 모든 이벤트 표시
    if (calendarMetadata.length === 0) return events;

    // visible set이 비어있으면 모든 이벤트 표시 (초기화 전)
    if (visibleCalendarUrlSet.size === 0) return events;

    return events.filter(event => {
      // 현재 모달에 열려있는 일정은 필터와 관계없이 항상 표시
      if (selectedEvent && event.id === selectedEvent.id) return true;
      // calendarUrl이 없는 이벤트는 항상 표시
      if (!event.calendarUrl) return true;
      // visible set에 있는 캘린더의 이벤트만 표시
      if (visibleCalendarUrlSet.has(event.calendarUrl)) return true;

      // 깜빡임 방지: 메타데이터에는 있는데 VisibleSet에 아직 없는 경우 (동기화 딜레이)
      if (calendarUrlSet.has(event.calendarUrl)) return true;

      // 메타데이터에도 없는 캘린더 (알 수 없는 캘린더) -> 안전하게 표시
      return true;
    });
  }, [events, visibleCalendarUrlSet, calendarMetadata, selectedEvent, calendarUrlSet]);

  const eventsByWeek = useMemo(() => {
    const map: Record<string, Event[]> = {};
    const allEvents = draftEvent ? [...filteredEvents, draftEvent] : filteredEvents;

    allEvents.forEach(e => {
      const [y, m, d] = e.date.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      const ws = getWeekStartForDate(dateObj);
      const wsStr = formatLocalDate(ws);
      if (!map[wsStr]) map[wsStr] = [];
      map[wsStr].push(e);
    });
    return map;
  }, [filteredEvents, draftEvent, getWeekStartForDate]);

  const todosByWeek = useMemo(() => {
    const map: Record<string, Todo[]> = {};
    todos.forEach(t => {
      if (!map[t.weekStart]) map[t.weekStart] = [];
      map[t.weekStart].push(t);
    });
    return map;
  }, [todos]);

  const lastSelectedIdsByWeekRef = useRef<Record<string, string[]>>({});
  const selectedEventIdsByWeek = useMemo(() => {
    const nextMap: Record<string, string[]> = {};
    const selectedSet = new Set(selectedEventIds);
    const lastMap = lastSelectedIdsByWeekRef.current;
    const EMPTY: string[] = [];

    Object.keys(eventsByWeek).forEach(weekStr => {
      const ids = eventsByWeek[weekStr]
        .map(e => e.id)
        .filter(id => selectedSet.has(id));

      const prevIds = lastMap[weekStr] || EMPTY;
      const isEqual = ids.length === prevIds.length && ids.every((val, index) => val === prevIds[index]);

      if (isEqual) {
        nextMap[weekStr] = prevIds;
      } else {
        nextMap[weekStr] = ids.length > 0 ? ids : EMPTY;
      }
    });

    lastSelectedIdsByWeekRef.current = nextMap;
    return nextMap;
  }, [selectedEventIds, eventsByWeek]);

  const getTodoWeekStart = useCallback((weekStart: Date) => {
    const base = new Date(weekStart);
    if (weekOrder === 'sun') {
      base.setDate(base.getDate() + 1);
    }
    return formatLocalDate(base);
  }, [weekOrder]);

  const getCurrentTodoWeekStart = useCallback(() => {
    const currentWeekStart = getWeekStartForDate(new Date());
    return getTodoWeekStart(currentWeekStart);
  }, [getWeekStartForDate, getTodoWeekStart]);

  // URL 해시에서 일기 날짜 파싱: #diary/2026-01-20
  const parseDiaryFromHash = (): string | null => {
    if (typeof window === 'undefined') return null;
    const hash = window.location.hash;
    const match = hash.match(/^#diary\/(\d{4}-\d{2}-\d{2})$/);
    return match ? match[1] : null;
  };

  // 초기 상태: URL 해시 기반
  const [activeDiaryDate, setActiveDiaryDate] = useState<string | null>(() => parseDiaryFromHash());
  const [isDiaryModalOpen, setIsDiaryModalOpen] = useState<boolean>(() => !!parseDiaryFromHash());
  // 캘린더가 한 번이라도 렌더링되었는지 추적 (숨기기 vs 렌더링 안함 결정용)
  const [calendarMounted, setCalendarMounted] = useState<boolean>(() => !parseDiaryFromHash());
  const [showRoutines, setShowRoutines] = useState(true); // 루틴 표시 여부 상태 추가
  const [showTodos, setShowTodos] = useState(true); // 투두 리스트 표시 여부 상태 추가
  const [diaryEntries, setDiaryEntries] = useState<Record<string, DiaryEntry>>({});
  const diaryRangeRef = useRef<{ startDate: string; endDate: string } | null>(null);
  const diaryFetchIdRef = useRef<ReturnType<typeof setTimeout> | number | null>(null);
  const diaryFetchModeRef = useRef<'idle' | 'timeout' | null>(null);
  const diaryInFlightRef = useRef<Record<string, Promise<DiaryEntry | null> | null>>({});
  const loadDataInFlightRef = useRef(false);
  const lastLoadSessionRef = useRef<string | null>(null);
  const lastLoadAtRef = useRef<number>(0);

  const CACHE_VERSION = 'v1';
  const getCacheKey = (suffix: string) => {
    if (!session?.user?.id || typeof window === 'undefined') return null;
    return `calendarCache:${CACHE_VERSION}:${session.user.id}:${suffix}`;
  };

  const readCache = <T,>(key: string, ttlMs: number): T | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;

      // 암호화된 데이터 복호화 시도
      const decrypted = decryptData<{ savedAt: number; data: T }>(raw);

      // 복호화 성공 시
      if (decrypted && decrypted.savedAt) {
        if (Date.now() - decrypted.savedAt > ttlMs) return null;
        return decrypted.data;
      }

      // 복호화 실패 시 (기존 평문 데이터일 수 있음 - 마이그레이션 생략하고 그냥 날림)
      return null;
    } catch {
      return null;
    }
  };

  const writeCache = (key: string, data: unknown) => {
    if (typeof window === 'undefined') return;
    try {
      const payload = { savedAt: Date.now(), data };
      const encrypted = encryptData(payload);
      window.localStorage.setItem(key, encrypted);
    } catch {
      // ignore quota errors
    }
  };


  useEffect(() => {
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSessionLoading(false); // 세션 확인 완료
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const rolloverTodosToCurrentWeek = async (todosData: Todo[]) => {
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
  };

  const getEventRange = () => {
    const currentWeekStart = getWeekStartForDate(new Date());
    const firstWeekStart = new Date(currentWeekStart);
    // Add a small buffer to ensure smooth scrolling
    const bufferWeeks = 4;
    firstWeekStart.setDate(firstWeekStart.getDate() - (pastWeeks + bufferWeeks) * 7);

    const lastWeekStart = new Date(currentWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() + (futureWeeks + bufferWeeks) * 7);

    const startDate = formatLocalDate(firstWeekStart);
    const lastDate = new Date(lastWeekStart);
    lastDate.setDate(lastDate.getDate() + 6);
    const endDate = formatLocalDate(lastDate);

    return { startDate, endDate };
  };

  const loadData = async (force: boolean = false) => {
    if (!session) return;
    if (loadDataInFlightRef.current) return;
    const sessionId = session.user?.id || null;
    const now = Date.now();
    if (!force && sessionId && lastLoadSessionRef.current === sessionId && (now - lastLoadAtRef.current) < 1500) {
      return;
    }
    loadDataInFlightRef.current = true;
    try {
      const startAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const cacheKey = getCacheKey('core');
      const cacheTtlMs = 5 * 60 * 1000;

      if (cacheKey) {
        const cached = readCache<{
          events: Event[];
          routines: Routine[];
          routineCompletions: RoutineCompletion[];
          todos: Todo[];
          dayDefinitions: Record<string, string>;
        }>(cacheKey, cacheTtlMs);

        if (cached) {
          // 캐시 복원 시에도 로컬 이벤트 유지
          setEvents(prev => {
            const cachedIds = new Set((cached.events || []).map(e => e.id));
            const localOnly = prev.filter(e => !cachedIds.has(e.id));
            return [...(cached.events || []), ...localOnly];
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
      const { startDate, endDate } = getEventRange();
      const [eventsData, routinesData, completionsData, todosData, dayDefinitionsData] = await Promise.all([
        fetchEvents(startDate, endDate),
        fetchRoutines(),
        fetchRoutineCompletions(),
        fetchTodos(),
        fetchDayDefinitions(),
      ]);
      // 서버 데이터와 로컬 상태 병합: 서버에 없는 로컬 이벤트 유지
      setEvents(prev => {
        const serverIds = new Set(eventsData.map(e => e.id));
        // 로컬에만 있는 이벤트 (아직 서버 응답에 포함되지 않은 것) 유지
        const localOnly = prev.filter(e => !serverIds.has(e.id));
        return [...eventsData, ...localOnly];
      });
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
    } finally {
      loadDataInFlightRef.current = false;
    }
  };

  const getDiaryRange = () => {
    const currentWeekStart = getWeekStartForDate(new Date());
    const firstWeekStart = new Date(currentWeekStart);
    const prefetchWeeks = 4;
    firstWeekStart.setDate(firstWeekStart.getDate() - (pastWeeks + prefetchWeeks) * 7);
    const lastWeekStart = new Date(currentWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() + (futureWeeks - 1 + prefetchWeeks) * 7);
    const startDate = formatLocalDate(firstWeekStart);
    const lastDate = new Date(lastWeekStart);
    lastDate.setDate(lastDate.getDate() + 6);
    const endDate = formatLocalDate(lastDate);
    return { startDate, endDate };
  };

  const loadDiaryEntriesForRange = async (startDate: string, endDate: string) => {
    if (!session) return;

    const cacheKey = getCacheKey(`diary:${startDate}:${endDate}`);
    const cacheTtlMs = 5 * 60 * 1000;
    if (cacheKey) {
      const cached = readCache<Record<string, DiaryEntry>>(cacheKey, cacheTtlMs);
      if (cached) {
        setDiaryEntries(cached);
      }
    }

    const networkStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const entries = await fetchDiaryEntriesByRange(startDate, endDate);
    const nextMap = (entries || []).reduce((acc: Record<string, DiaryEntry>, entry) => {
      acc[entry.date] = entry;
      return acc;
    }, {});
    diaryRangeRef.current = { startDate, endDate };
    setDiaryEntries(nextMap);
    const networkEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    console.log(`network:diary-range ${startDate}~${endDate} ${Math.round(networkEnd - networkStart)} ms`);
    if (cacheKey) {
      writeCache(cacheKey, nextMap);
    }
  };

  useEffect(() => {
    loadData();
    const loadAvatar = async () => {
      const url = await getUserAvatar();
      setAvatarUrl(url);
    };
    if (session) {
      loadAvatar();
    }
  }, [session, pastWeeks, futureWeeks, weekOrder]);

  // URL 해시에 일기 날짜가 있으면 데이터 로드
  useEffect(() => {
    if (!session) return;
    if (activeDiaryDate && isDiaryModalOpen) {
      handleOpenDiary(activeDiaryDate);
    }
  }, [session]);

  // 뒤로가기/앞으로가기 처리
  useEffect(() => {
    const handlePopState = () => {
      const diaryDate = parseDiaryFromHash();
      if (diaryDate) {
        setActiveDiaryDate(diaryDate);
        setIsDiaryModalOpen(true);
        handleOpenDiary(diaryDate);
      } else {
        setIsDiaryModalOpen(false);
        setActiveDiaryDate(null);
        if (!calendarMounted) {
          setCalendarMounted(true);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [calendarMounted]);

  // 캘린더 초기 로드 시 현재 주간으로 스크롤 (일기 모달이 열려있지 않은 경우)
  const hasInitialScrolledRef = useRef(false);
  useLayoutEffect(() => {
    if (!session || !calendarMounted || isDiaryModalOpen || hasInitialScrolledRef.current) return;

    // 약간의 지연 후 스크롤 (DOM 렌더링 완료 대기)
    const timer = setTimeout(() => {
      const todayElement = document.getElementById('current-week');
      if (todayElement && !hasInitialScrolledRef.current) {
        todayElement.scrollIntoView({ behavior: 'instant', block: 'center' });
        hasInitialScrolledRef.current = true;
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [session, calendarMounted, isDiaryModalOpen]);

  useEffect(() => {
    if (!session || typeof window === 'undefined') return;

    const { startDate, endDate } = getDiaryRange();
    const prev = diaryRangeRef.current;
    if (prev && prev.startDate === startDate && prev.endDate === endDate) {
      return;
    }

    if (diaryFetchIdRef.current !== null) {
      if (diaryFetchModeRef.current === 'idle' && 'cancelIdleCallback' in window) {
        (window as any).cancelIdleCallback(diaryFetchIdRef.current);
      } else {
        clearTimeout(diaryFetchIdRef.current as ReturnType<typeof setTimeout>);
      }
    }

    const scheduleFetch = () => {
      loadDiaryEntriesForRange(startDate, endDate);
    };

    if ('requestIdleCallback' in window) {
      diaryFetchModeRef.current = 'idle';
      diaryFetchIdRef.current = (window as any).requestIdleCallback(scheduleFetch, { timeout: 1000 });
    } else {
      diaryFetchModeRef.current = 'timeout';
      diaryFetchIdRef.current = setTimeout(scheduleFetch, 200);
    }
  }, [session, pastWeeks, futureWeeks, weekOrder]);

  // 주기적 자동 동기화
  useEffect(() => {
    if (!session) return;

    let syncInterval: NodeJS.Timeout | null = null;
    let isSyncingRef = { current: false }; // useRef 대신 객체 사용

    const ensureValidSession = async () => {
      const { data } = await supabase.auth.getSession();
      let currentSession = data?.session ?? null;
      const expiresAt = currentSession?.expires_at ? currentSession.expires_at * 1000 : null;

      if (!currentSession || (expiresAt && Date.now() > expiresAt - 60 * 1000)) {
        const refreshed = await supabase.auth.refreshSession();
        currentSession = refreshed.data?.session ?? null;
      }

      if (!currentSession?.access_token) {
        return null;
      }

      const userCheck = await supabase.auth.getUser();
      if (userCheck.error) {
        await supabase.auth.signOut();
        return null;
      }

      return currentSession;
    };

    const performAutoSync = async () => {
      // 이미 동기화 중이면 스킵
      if (isSyncingRef.current) {
        return; // 로그 제거
      }

      try {
        isSyncingRef.current = true;
        const validSession = await ensureValidSession();
        if (!validSession) {
          return;
        }
        const settings = await getCalDAVSyncSettings();

        if (!settings) {
          // 설정이 없으면 조용히 리턴 (에러 로그 없음)
          return;
        }

        if (!settings.enabled || settings.selectedCalendarUrls.length === 0) {
          console.log('자동 동기화 설정이 없거나 비활성화되어 있습니다.');
          return;
        }

        // 마지막 동기화 시간 확인
        // 새로고침 시에는 최소 간격(5분)만 체크, 주기적 동기화는 설정된 간격 체크
        const now = new Date();
        const lastSync = settings.lastSyncAt ? new Date(settings.lastSyncAt) : null;
        const minIntervalMs = 5 * 60 * 1000; // 최소 5분 간격

        if (lastSync && (now.getTime() - lastSync.getTime()) < minIntervalMs) {
          return; // 로그 제거
        }
        const config: CalDAVConfig = {
          serverUrl: settings.serverUrl,
          username: settings.username,
          password: settings.password,
        };

        // 캘린더 메타데이터 갱신 (기존 사용자 마이그레이션용)
        try {
          const allCalendars = await getCalendars(config);
          const selectedSet = new Set(settings.selectedCalendarUrls);
          const metadataToSave = allCalendars
            .filter(cal => selectedSet.has(cal.url))
            .map(cal => {
              const normalizedUrl = normalizeCalendarUrl(cal.url)!;
              return {
                url: normalizedUrl,
                displayName: cal.displayName,
                color: cal.color || '#3b82f6'
              };
            });

          saveCalendarMetadata(metadataToSave);

          // 기존 로컬 캘린더 보존: 스토리지에서 로컬 캘린더만 가져와서 병합
          const currentFullMetadata = getCalendarMetadata();
          const localCalendars = Object.values(currentFullMetadata).filter(c => c.isLocal);
          const combinedMetadata = [...metadataToSave, ...localCalendars];

          setCalendarMetadata(combinedMetadata);


        } catch (metaError) {
          console.warn('메타데이터 자동 갱신 실패:', metaError);
        }

        const syncResult = await syncSelectedCalendars(
          config,
          settings.selectedCalendarUrls,
          settings.lastSyncAt  // 마지막 동기화 시간 전달
        );
        await updateLastSyncTime();

        // 삭제가 있었거나 새 이벤트가 추가되었으면 데이터 다시 로드
        if (syncResult !== 0) {
          await loadData(true);
        }
      } catch (error: any) {
        console.error('자동 동기화 오류:', error);
      } finally {
        isSyncingRef.current = false;
      }
    };

    // 초기 동기화 (페이지 로드 시 즉시 실행, 단 최소 간격 체크)
    const performInitialSync = async () => {
      if (isSyncingRef.current) {
        return;
      }

      try {
        isSyncingRef.current = true;
        const validSession = await ensureValidSession();
        if (!validSession) {
          return;
        }
        const settings = await getCalDAVSyncSettings();
        if (!settings || !settings.enabled) {
          isSyncingRef.current = false;
          return;
        }

        // 페이지 새로고침 시에는 최소 간격을 두지 않고 즉시 동기화해서
        // 맥 캘린더에 방금 추가/삭제한 일정이 바로 반영되도록 한다.
        const config: CalDAVConfig = {
          serverUrl: settings.serverUrl,
          username: settings.username,
          password: settings.password,
        };

        // 캘린더 메타데이터 갱신 (기존 사용자 마이그레이션용)
        try {
          const allCalendars = await getCalendars(config);
          const selectedSet = new Set(settings.selectedCalendarUrls);
          const metadataToSave = allCalendars
            .filter(cal => selectedSet.has(cal.url))
            .map(cal => {
              const normalizedUrl = normalizeCalendarUrl(cal.url)!;
              return {
                url: normalizedUrl,
                displayName: cal.displayName,
                color: cal.color || '#3b82f6'
              };
            });

          saveCalendarMetadata(metadataToSave);

          // 기존 로컬 캘린더 보존
          const currentFullMetadata = getCalendarMetadata();
          const localCalendars = Object.values(currentFullMetadata).filter(c => c.isLocal);
          const combinedMetadata = [...metadataToSave, ...localCalendars];

          setCalendarMetadata(combinedMetadata);

          // 가시성 설정 초기화
          setVisibleCalendarUrlSet(prev => {
            if (prev.size === 0 && metadataToSave.length > 0) {
              return new Set(metadataToSave.map(m => m.url));
            }
            return prev;
          });
        } catch (metaError) {
          console.warn('메타데이터 초기 갱신 실패:', metaError);
        }

        const syncResult = await syncSelectedCalendars(
          config,
          settings.selectedCalendarUrls,
          settings.lastSyncAt
        );
        await updateLastSyncTime();

        // 삭제가 있었거나 새 이벤트가 추가되었으면 데이터 다시 로드
        if (syncResult !== 0) {
          await loadData(true);
        }
      } catch (error) {
        console.error('초기 동기화 오류:', error);
      } finally {
        isSyncingRef.current = false;
      }
    };

    // 초기 동기화는 idle 타이밍으로 미룸 (첫 화면 렌더 우선)
    let initialSyncId: number | ReturnType<typeof setTimeout> | null = null;
    let initialSyncMode: 'idle' | 'timeout' | null = null;
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      initialSyncMode = 'idle';
      initialSyncId = (window as any).requestIdleCallback(performInitialSync, { timeout: 1500 });
    } else {
      initialSyncMode = 'timeout';
      initialSyncId = setTimeout(performInitialSync, 300);
    }

    // 주기적 동기화 설정
    const setupPeriodicSync = async () => {
      try {
        const settings = await getCalDAVSyncSettings();
        if (!settings || !settings.enabled) {
          console.log('자동 동기화 설정이 없거나 비활성화되어 있습니다.');
          return;
        }

        const intervalMs = settings.syncIntervalMinutes * 60 * 1000;
        console.log(`자동 동기화 주기 설정: ${settings.syncIntervalMinutes}분마다`);

        syncInterval = setInterval(() => {
          performAutoSync();
        }, intervalMs);
      } catch (error) {
        console.error('주기적 동기화 설정 오류:', error);
      }
    };

    setupPeriodicSync();

    return () => {
      if (initialSyncId !== null && typeof window !== 'undefined') {
        if (initialSyncMode === 'idle' && 'cancelIdleCallback' in window) {
          (window as any).cancelIdleCallback(initialSyncId);
        } else {
          clearTimeout(initialSyncId as ReturnType<typeof setTimeout>);
        }
      }
      if (syncInterval) {
        clearInterval(syncInterval);
      }
    };
  }, [session]);

  const handleCalDAVSyncComplete = async (count: number) => {
    // 중복 데이터 삭제
    const deletedCount = await deleteDuplicateEvents();
    if (deletedCount > 0) {
      console.log(`${deletedCount}개의 중복 이벤트가 삭제되었습니다.`);
    }

    await loadData(true);

    // 메타데이터 리로드 & 가시성 업데이트
    const metadata = Object.values(getCalendarMetadata());
    setCalendarMetadata(metadata);
    setVisibleCalendarUrlSet(prev => {
      const newSet = new Set(prev);
      metadata.forEach(m => newSet.add(m.url));
      return newSet;
    });

    const message = deletedCount > 0
      ? `${count}개의 일정이 동기화되었습니다. (${deletedCount}개 중복 삭제)`
      : `${count}개의 일정이 동기화되었습니다.`;
    alert(message);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // 현재 화면 중심에 있는 주간 ID 캡처 (스크롤 복원용)
  const captureCurrentView = () => {
    if (!containerRef.current) return;

    // 현재 뷰포트 중앙 좌표
    const viewportCenter = window.innerHeight / 2;
    const weekCards = containerRef.current.querySelectorAll('[data-week-id]');

    let closestWeekId: string | null = null;
    let minDiff = Infinity;
    let offset = 0;

    for (const card of weekCards) {
      const rect = card.getBoundingClientRect();
      const centerDiff = Math.abs((rect.top + rect.height / 2) - viewportCenter);

      if (centerDiff < minDiff) {
        minDiff = centerDiff;
        closestWeekId = card.getAttribute('data-week-id');
        offset = rect.top; // 현재 top 위치 저장
      }
    }

    if (closestWeekId) {
      anchorWeekIdRef.current = closestWeekId;
      anchorOffsetRef.current = offset;
    }
  };

  const handleToggleRoutines = () => {
    captureCurrentView(); // 토글 전 위치 기억
    setShowRoutines(prev => !prev);
  };

  const handleToggleTodos = () => {
    captureCurrentView(); // 토글 전 위치 기억
    setShowTodos(prev => !prev);
  };

  // showRoutines 또는 showTodos 변경 시 스크롤 복원
  useLayoutEffect(() => {
    if (anchorWeekIdRef.current) {
      const anchorElement = containerRef.current?.querySelector(
        `[data-week-id="${anchorWeekIdRef.current}"]`
      );
      if (anchorElement) {
        // 이전 요소가 화면에 있던 위치(offset)와 현재 위치 차이만큼 스크롤 조정
        // 하지만 높이가 변했으므로, 요소를 다시 중앙(또는 원래 위치)으로 가져오는 것이 안전
        anchorElement.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
      anchorWeekIdRef.current = null;
      anchorOffsetRef.current = 0;
    }
  }, [showRoutines, showTodos]);

  const handleOpenRoutineModal = () => {
    setIsProfileMenuOpen(false);
    setIsRoutineModalOpen(true);
  };

  const handleOpenCalDAVModal = () => {
    setIsProfileMenuOpen(false);
    setIsCalDAVModalOpen(true);
  };

  const handleOpenSettingsModal = () => {
    setIsProfileMenuOpen(false);
    setIsSettingsModalOpen(true);
  };

  const handleLogoutFromMenu = () => {
    setIsProfileMenuOpen(false);
    handleLogout();
  };





  const containerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const anchorWeekIdRef = useRef<string | null>(null);
  const anchorOffsetRef = useRef<number>(0);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // 프로필 드롭다운 외부 클릭 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  // Intersection Observer for Infinite Scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (entry.target === topSentinelRef.current) {
              // 과거 주 로드 전: 현재 보이는 첫 번째 주간 요소 기억
              const weekCards = containerRef.current?.querySelectorAll('[data-week-id]');
              if (weekCards && weekCards.length > 0) {
                for (const card of weekCards) {
                  const rect = card.getBoundingClientRect();
                  // 화면에 보이는 첫 번째 카드 찾기
                  if (rect.bottom > 0) {
                    anchorWeekIdRef.current = card.getAttribute('data-week-id');
                    anchorOffsetRef.current = rect.top;
                    break;
                  }
                }
              }
              setPastWeeks((prev) => prev + 8);
            } else if (entry.target === bottomSentinelRef.current) {
              // Load next weeks (8 weeks = approx 2 months)
              setFutureWeeks((prev) => prev + 8);
            }
          }
        });
      },
      { rootMargin: '400px' } // Load before reaching the edge
    );

    if (topSentinelRef.current) observer.observe(topSentinelRef.current);
    if (bottomSentinelRef.current) observer.observe(bottomSentinelRef.current);

    return () => observer.disconnect();
  }, [session]);

  // Maintain scroll position when loading previous weeks
  useLayoutEffect(() => {
    if (anchorWeekIdRef.current) {
      const anchorElement = containerRef.current?.querySelector(
        `[data-week-id="${anchorWeekIdRef.current}"]`
      );
      if (anchorElement) {
        const newRect = anchorElement.getBoundingClientRect();
        const scrollDiff = newRect.top - anchorOffsetRef.current;
        if (Math.abs(scrollDiff) > 1) {
          window.scrollBy(0, scrollDiff);
        }
      }
      anchorWeekIdRef.current = null;
      anchorOffsetRef.current = 0;
    }
  }, [pastWeeks]);

  // pastWeeks를 localStorage에 저장
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('pastWeeks', String(pastWeeks));
    }
  }, [pastWeeks]);

  const weeks = useMemo(() => {
    const res = [];
    const today = new Date();
    const currentWeekStart = new Date(today);
    const dayOfWeek = currentWeekStart.getDay();
    const diff = weekOrder === 'sun'
      ? -dayOfWeek
      : (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    currentWeekStart.setDate(today.getDate() + diff);
    currentWeekStart.setHours(0, 0, 0, 0);

    for (let i = -pastWeeks; i < futureWeeks; i++) {
      const weekStart = new Date(currentWeekStart);
      weekStart.setDate(currentWeekStart.getDate() + (i * 7));
      res.push(weekStart);
    }
    return res;
  }, [pastWeeks, futureWeeks, weekOrder]);

  const renderedWeeksData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay();
    const diff = weekOrder === 'sun' ? -dayOfWeek : (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    const currentWS = new Date(today);
    currentWS.setDate(today.getDate() + diff);
    currentWS.setHours(0, 0, 0, 0);
    const currentMs = currentWS.getTime();

    return weeks.map(weekStart => {
      const weekStartStr = formatLocalDate(weekStart);
      const todoWeekStartStr = getTodoWeekStart(weekStart);

      const ms = weekStart.getTime();
      let weekStatus: 'current' | 'prev' | 'next' | 'other' = 'other';
      if (ms === currentMs) weekStatus = 'current';
      else if (ms === currentMs - 7 * 86400000) weekStatus = 'prev';
      else if (ms === currentMs + 7 * 86400000) weekStatus = 'next';

      return {
        weekStart,
        weekStartStr,
        todoWeekStartStr,
        weekStatus
      };
    });
  }, [weeks, weekOrder, getTodoWeekStart]);



  const handleAddEvent = useCallback(async (event: Omit<Event, 'id'>, keepOpen?: boolean) => {
    console.log('[handleAddEvent] 저장할 이벤트:', event);
    const newEvent = await createEvent(event);
    console.log('[handleAddEvent] 서버 응답:', newEvent);
    if (newEvent) {
      setEvents(prev => [...prev, newEvent]);

      // 같은 날짜의 드래프트만 지움 (다른 날짜의 새 드래프트 보호)
      setDraftEvent(prev => {
        if (prev && prev.date === newEvent.date) {
          return null;
        }
        return prev;
      });

      // 새 이벤트의 캘린더가 visible set에 없으면 추가
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
        // 모달이 아직 같은 이벤트를 보고 있을 때만 selectedEvent 설정
        setSelectedEvent(prev => {
          // 이미 다른 이벤트를 선택했거나, 다른 날짜로 이동한 경우 무시
          if (prev !== null) return prev;
          return newEvent;
        });
      } else {
        setIsEventModalOpen(false);
      }
      // 캐시 무효화 제거: loadData가 서버에서 다시 가져올 때까지 로컬 상태 유지
    }
  }, [createEvent, setEvents, setDraftEvent, setSelectedEvent, setIsEventModalOpen]);

  const handleDeleteEvent = useCallback(async (eventId: string) => {
    const success = await deleteEvent(eventId);
    if (success) {
      setEvents(prev => prev.filter(e => e.id !== eventId));
      setSelectedEvent(prev => (prev?.id === eventId ? null : prev));
      setSelectedEventIds(prev => prev.filter(id => id !== eventId));
      // 캐시 무효화 제거
    }
  }, [deleteEvent, setEvents, setSelectedEvent, setSelectedEventIds]);

  const handleUpdateEvent = useCallback(async (eventId: string, updates: Partial<Event>) => {
    // Optimistic Update
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, ...updates } : e));
    setSelectedEvent(prev => (prev?.id === eventId ? { ...prev, ...updates } : prev));

    // Debounce API call
    if (debouncedUpdateRef.current[eventId]) {
      clearTimeout(debouncedUpdateRef.current[eventId]);
    }

    debouncedUpdateRef.current[eventId] = setTimeout(async () => {
      await updateEvent(eventId, updates);
      delete debouncedUpdateRef.current[eventId];
    }, 1000);
  }, [setEvents, setSelectedEvent, debouncedUpdateRef, updateEvent]);

  const handleDeleteSelectedEvents = useCallback(async () => {
    if (selectedEventIds.length === 0) return;
    const idsToDelete = [...selectedEventIds];
    const results = await Promise.all(idsToDelete.map(id => deleteEvent(id)));
    const deletedIds = idsToDelete.filter((_, idx) => results[idx]);
    if (deletedIds.length > 0) {
      setEvents(prev => prev.filter(e => !deletedIds.includes(e.id)));
      setSelectedEvent(prev => (prev && deletedIds.includes(prev.id) ? null : prev));
      setSelectedEventIds(prev => prev.filter(id => !deletedIds.includes(id)));
      // 캐시 무효화 제거
    }
  }, [selectedEventIds, deleteEvent, setEvents, setSelectedEvent, setSelectedEventIds]);

  const handleAddRoutine = useCallback(async (routine: Omit<Routine, 'id'>) => {
    const newRoutine = await createRoutine(routine);
    if (newRoutine) {
      setRoutines(prev => [...prev, newRoutine]);
    }
  }, [createRoutine, setRoutines]);

  const handleDeleteRoutine = useCallback(async (routineId: string) => {
    const success = await deleteRoutine(routineId);
    if (success) {
      setRoutines(prev => prev.filter(r => r.id !== routineId));
      setRoutineCompletions(prev => prev.filter(rc => rc.routineId !== routineId));
    }
  }, [deleteRoutine, setRoutines, setRoutineCompletions]);

  const handleToggleRoutine = useCallback(async (routineId: string, date: string) => {
    // We need current routineCompletions to calculate next state.
    // Better use functional update to avoid stale closure.
    setRoutineCompletions(prev => {
      const existing = prev.find(rc => rc.routineId === routineId && rc.date === date);
      const completed = existing ? !existing.completed : true;

      // We handle the background API call separately.
      // But we need to update state immediately.
      toggleRoutineCompletion(routineId, date, completed).then(updated => {
        if (!updated) {
          // Revert? (Complex for now).
        }
      });

      if (existing) {
        return prev.map(rc =>
          rc.routineId === routineId && rc.date === date
            ? { ...rc, completed }
            : rc
        );
      } else {
        // When adding a new completion, we need the full object structure.
        // For now, we'll use a simplified version for optimistic update.
        // The actual `updated` object from the API call would be more complete.
        return [...prev, { routineId, date, completed, id: 'temp-id', createdAt: new Date().toISOString() }];
      }
    });
  }, [setRoutineCompletions, toggleRoutineCompletion]);

  const handleAddTodo = useCallback(async (weekStart: string, text: string) => {
    const newTodo = await createTodo({
      weekStart,
      text,
      completed: false,
    });
    if (newTodo) {
      setTodos(prev => [...prev, newTodo]);
    }
  }, [createTodo, setTodos]);

  const handleToggleTodo = useCallback(async (todoId: string) => {
    setTodos(prev => {
      const todo = prev.find(t => t.id === todoId);
      if (!todo) return prev;
      const completed = !todo.completed;
      updateTodo(todoId, { completed }); // Fire and forget for optimistic update
      return prev.map(t => t.id === todoId ? { ...t, completed } : t);
    });
  }, [setTodos, updateTodo]);

  const handleUpdateTodo = useCallback(async (todoId: string, text: string) => {
    const updated = await updateTodo(todoId, { text });
    if (updated) {
      setTodos(prev => prev.map(t => t.id === todoId ? updated : t));
    }
  }, [updateTodo, setTodos]);

  const handleDeleteTodo = useCallback(async (todoId: string) => {
    const success = await deleteTodo(todoId);
    if (success) {
      setTodos(prev => prev.filter(t => t.id !== todoId));
    }
  }, [deleteTodo, setTodos]);

  const handleSaveDayDefinition = useCallback(async (date: string, text: string) => {
    const saved = await upsertDayDefinition(date, text);
    if (saved) {
      setDayDefinitions(prev => ({ ...prev, [date]: text }));
    }
  }, [upsertDayDefinition, setDayDefinitions]);

  const handleDeleteDayDefinition = useCallback(async (date: string) => {
    const success = await deleteDayDefinition(date);
    if (success) {
      setDayDefinitions(prev => {
        const next = { ...prev };
        delete next[date];
        return next;
      });
    }
  }, [deleteDayDefinition, setDayDefinitions]);

  const handleOpenDiary = async (date: string) => {
    setActiveDiaryDate(date);
    setIsDiaryModalOpen(true);

    // URL 해시 업데이트 (뒤로가기 지원)
    if (typeof window !== 'undefined') {
      window.history.pushState({ diary: date }, '', `#diary/${date}`);
    }

    // 로컬 캐시에서 먼저 로드
    if (typeof window !== 'undefined') {
      const cached = window.localStorage.getItem(`diaryCache:${date}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as DiaryEntry;
          setDiaryEntries(prev => ({ ...prev, [date]: parsed }));
        } catch {
          window.localStorage.removeItem(`diaryCache:${date}`);
        }
      }
    }

    const startAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!diaryEntries[date]) {
      if (!diaryInFlightRef.current[date]) {
        diaryInFlightRef.current[date] = fetchDiaryEntry(date);
      }
      const entry = await diaryInFlightRef.current[date];
      diaryInFlightRef.current[date] = null;
      if (entry) {
        setDiaryEntries(prev => ({ ...prev, [date]: entry }));
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(`diaryCache:${date}`, JSON.stringify(entry));
        }
      }
    }
    const endAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = Math.round(endAt - startAt);
    console.log(`diary:fetch:${date}: ${elapsed} ms`);
  };

  const handleDiarySaved = (entry: DiaryEntry) => {
    setDiaryEntries(prev => ({ ...prev, [entry.date]: entry }));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`diaryCache:${entry.date}`, JSON.stringify(entry));
    }
  };

  const handleCloseDiary = () => {
    const wasCalendarMounted = calendarMounted;
    const diaryDate = activeDiaryDate; // 스크롤용으로 저장
    setIsDiaryModalOpen(false);
    setActiveDiaryDate(null);
    // 캘린더가 아직 마운트되지 않았다면 마운트
    if (!calendarMounted) {
      setCalendarMounted(true);
    }
    // URL 해시 제거
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', window.location.pathname);
    }
    // 캘린더가 처음 마운트되는 경우 일기 날짜의 주간으로 스크롤
    if (!wasCalendarMounted && diaryDate) {
      setTimeout(() => {
        // 일기 날짜를 기반으로 주간 시작일 계산
        const date = new Date(diaryDate);
        const dayOfWeek = date.getDay();
        const diff = weekOrder === 'sun'
          ? -dayOfWeek
          : (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
        date.setDate(date.getDate() + diff);
        const weekId = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        const weekElement = document.querySelector(`[data-week-id="${weekId}"]`);
        if (weekElement) {
          weekElement.scrollIntoView({ behavior: 'instant', block: 'center' });
        } else {
          // 해당 주간이 없으면 현재 주간으로 스크롤
          const todayElement = document.getElementById('current-week');
          if (todayElement) {
            todayElement.scrollIntoView({ behavior: 'instant', block: 'center' });
          }
        }
      }, 100);
    }
  };

  const handleDiaryDelete = async (date: string) => {
    const success = await deleteDiaryEntry(date);
    if (success) {
      setDiaryEntries(prev => {
        const next = { ...prev };
        delete next[date];
        return next;
      });
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(`diaryCache:${date}`);
      }
      handleCloseDiary();
    }
  };

  const scrollToToday = () => {
    const todayElement = document.getElementById('current-week');
    if (todayElement) {
      // 즉시 스크롤 (버튼 클릭 시)
      todayElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      // 요소가 아직 렌더링되지 않았다면 잠시 후 다시 시도
      setTimeout(() => {
        const retryElement = document.getElementById('current-week');
        if (retryElement) {
          retryElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  };

  // 키보드로 선택 이벤트 삭제 (Backspace/Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedEventIds.length === 0) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable ||
          tag === 'BUTTON'
        ) {
          return;
        }
      }

      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        handleDeleteSelectedEvents();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEventIds]);

  // 일정 선택 해제: 일정 외부 클릭
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (selectedEventIds.length === 0) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-event-item="true"]')) return;
      setSelectedEventIds([]);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [selectedEventIds]);



  const diaryCompletionMap = useMemo(() => {
    const stripHtml = (value: string) =>
      value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    return Object.keys(diaryEntries).reduce((acc: Record<string, boolean>, date) => {
      const entry = diaryEntries[date];
      acc[date] = Boolean(entry?.title?.trim() || stripHtml(entry?.content || ''));
      return acc;
    }, {});
  }, [diaryEntries]);

  // 세션 확인 중에는 빈 화면 표시 (Login 깜빡임 방지)
  if (sessionLoading) {
    return null;
  }

  if (!session) {
    return <Login />;
  }

  const userInitial = session?.user?.email?.[0]?.toUpperCase() || 'U';


  const handleAddLocalCalendar = (name: string, color: string) => {
    // 임의의 고유 ID 생성 (local:timestamp:random)
    const newId = `local:${Date.now()}:${Math.floor(Math.random() * 1000)}`;
    const newCal: CalendarMetadata = {
      url: newId,
      displayName: name,
      color: color,
      isLocal: true,
    };

    const nextMetadata = [...calendarMetadata, newCal];
    setCalendarMetadata(nextMetadata);
    saveCalendarMetadata(nextMetadata);

    // 새 캘린더는 기본적으로 보이게 설정
    setVisibleCalendarUrlSet(prev => {
      const next = new Set(prev);
      next.add(newId);
      return next;
    });

    return newId;
  };

  const handleUpdateLocalCalendar = (url: string, updates: Partial<CalendarMetadata>) => {
    const nextMetadata = calendarMetadata.map(cal => {
      if (cal.url === url) {
        return { ...cal, ...updates };
      }
      return cal;
    });
    setCalendarMetadata(nextMetadata);
    saveCalendarMetadata(nextMetadata);
  };

  const handleDeleteLocalCalendar = (url: string) => {
    const nextMetadata = calendarMetadata.filter(cal => cal.url !== url);
    setCalendarMetadata(nextMetadata);
    saveCalendarMetadata(nextMetadata);
  };


  return (
    <div className={styles.appContainer}>
      {sessionLoading ? null : !session ? (
        <Login />
      ) : (
        <div className={styles.appLayout}>
          <>
            {!isCalendarPopupOpen && (
              <CalendarToggleButton onClick={() => setIsCalendarPopupOpen(true)} />
            )}
            {isCalendarPopupOpen && (
              <CalendarListPopup
                calendars={calendarMetadata}
                visibleUrlSet={visibleCalendarUrlSet}
                onToggle={handleToggleCalendarVisibility}
                onClose={() => setIsCalendarPopupOpen(false)}
                onOpenSyncSettings={handleOpenCalDAVModal}
                onAddLocalCalendar={handleAddLocalCalendar}
                onUpdateLocalCalendar={handleUpdateLocalCalendar}
                onDeleteLocalCalendar={handleDeleteLocalCalendar}
              />
            )}
          </>

          <AppHeader
            currentYear={currentYear}
            currentMonth={currentMonth}
            avatarUrl={avatarUrl}
            userInitial={userInitial}
            profileMenuRef={profileMenuRef}
            isProfileMenuOpen={isProfileMenuOpen}
            onScrollToToday={scrollToToday}
            onToggleProfileMenu={() => setIsProfileMenuOpen((prev) => !prev)}
            onOpenRoutine={handleOpenRoutineModal}
            showRoutines={showRoutines}
            onToggleRoutines={handleToggleRoutines}
            showTodos={showTodos}
            onToggleTodos={handleToggleTodos}
            onOpenCalDAV={handleOpenCalDAVModal}
            onOpenSettings={handleOpenSettingsModal}
            onLogout={handleLogoutFromMenu}
          />

          <div className={styles.appContent} ref={containerRef}>
            <CalendarList
              weeksData={renderedWeeksData}
              eventsByWeek={eventsByWeek}
              todosByWeek={todosByWeek}
              routines={routines}
              routineCompletions={routineCompletions}
              dayDefinitions={dayDefinitions}
              selectedEventIdsByWeek={selectedEventIdsByWeek}
              weekOrder={weekOrder}
              diaryCompletionMap={diaryCompletionMap}
              showRoutines={showRoutines}
              showTodos={showTodos}
              onDateClick={handleDateClick}
              onEventClick={handleEventClick}
              onEventDoubleClick={handleEventDoubleClick}
              onDeleteEvent={handleDeleteEvent}
              onToggleRoutine={handleToggleRoutine}
              onAddTodo={handleAddTodo}
              onToggleTodo={handleToggleTodo}
              onUpdateTodo={handleUpdateTodo}
              onDeleteTodo={handleDeleteTodo}
              onSaveDayDefinition={handleSaveDayDefinition}
              onDeleteDayDefinition={handleDeleteDayDefinition}
              onOpenDiary={handleOpenDiary}
              setCurrentYear={setCurrentYear}
              setCurrentMonth={setCurrentMonth}
              topSentinelRef={topSentinelRef}
              bottomSentinelRef={bottomSentinelRef}
            />
          </div>

          <AppModals
            popupPosition={popupPosition}
            selectedDate={selectedDate}
            isEventModalOpen={isEventModalOpen}
            selectedEvent={selectedEvent}
            draftEvent={draftEvent}
            modalSessionId={modalSessionId}
            routines={routines}
            calendars={calendarMetadata}
            isRoutineModalOpen={isRoutineModalOpen}
            isCalDAVModalOpen={isCalDAVModalOpen}
            isSettingsModalOpen={isSettingsModalOpen}
            avatarUrl={avatarUrl}
            weekOrder={weekOrder}
            onCloseEventModal={() => {
              setIsEventModalOpen(false);
              setDraftEvent(null);
            }}
            onAddEvent={handleAddEvent}
            onUpdateEvent={handleUpdateEvent}
            onDeleteEvent={handleDeleteEvent}
            onDraftUpdate={handleUpdateDraft}
            onCloseRoutineModal={() => setIsRoutineModalOpen(false)}
            onAddRoutine={handleAddRoutine}
            onDeleteRoutine={handleDeleteRoutine}
            onCloseCalDAVModal={() => setIsCalDAVModalOpen(false)}
            onSyncComplete={handleCalDAVSyncComplete}
            onCloseSettings={() => setIsSettingsModalOpen(false)}
            onSettingsSaved={({ avatarUrl: nextAvatarUrl, weekOrder: nextWeekOrder }) => {
              setAvatarUrl(nextAvatarUrl);
              setWeekOrder(nextWeekOrder);
              window.localStorage.setItem('weekOrder', nextWeekOrder);
            }}
          />
        </div>
      )}

      {isDiaryModalOpen && activeDiaryDate && (
        <DiaryModal
          date={activeDiaryDate}
          events={events.filter(event => event.date === activeDiaryDate)}
          dayDefinition={dayDefinitions[activeDiaryDate]}
          weekOrder={weekOrder}
          initialEntry={diaryEntries[activeDiaryDate]}
          onClose={handleCloseDiary}
          onSaved={handleDiarySaved}
          onSave={upsertDiaryEntry}
          onDelete={handleDiaryDelete}
        />
      )}
    </div>
  );
}

interface CalendarListProps {
  weeksData: any[];
  eventsByWeek: Record<string, Event[]>;
  todosByWeek: Record<string, Todo[]>;
  routines: Routine[];
  routineCompletions: RoutineCompletion[];
  dayDefinitions: Record<string, string>;
  selectedEventIdsByWeek: Record<string, string[]>;
  weekOrder: WeekOrder;
  diaryCompletionMap: Record<string, boolean>;
  showRoutines: boolean;
  showTodos: boolean;
  onDateClick: any;
  onEventClick: any;
  onEventDoubleClick: any;
  onDeleteEvent: any;
  onToggleRoutine: any;
  onAddTodo: any;
  onToggleTodo: any;
  onUpdateTodo: any;
  onDeleteTodo: any;
  onSaveDayDefinition: any;
  onDeleteDayDefinition: any;
  onOpenDiary: any;
  setCurrentYear: any;
  setCurrentMonth: any;
  topSentinelRef: any;
  bottomSentinelRef: any;
}

const CalendarList = memo(({
  weeksData,
  eventsByWeek,
  todosByWeek,
  routines,
  routineCompletions,
  dayDefinitions,
  selectedEventIdsByWeek,
  weekOrder,
  diaryCompletionMap,
  showRoutines,
  showTodos,
  onDateClick,
  onEventClick,
  onEventDoubleClick,
  onDeleteEvent,
  onToggleRoutine,
  onAddTodo,
  onToggleTodo,
  onUpdateTodo,
  onDeleteTodo,
  onSaveDayDefinition,
  onDeleteDayDefinition,
  onOpenDiary,
  setCurrentYear,
  setCurrentMonth,
  topSentinelRef,
  bottomSentinelRef
}: CalendarListProps) => {
  return (
    <div className={styles.appWeeksList}>
      <div ref={topSentinelRef} className={styles.appSentinel} />
      {weeksData.map(({ weekStart, weekStartStr, todoWeekStartStr, weekStatus }) => (
        <div key={weekStartStr} id={weekStatus === 'current' ? 'current-week' : undefined}>
          <ObserverWrapper
            onIntersect={() => {
              setCurrentYear(weekStart.getFullYear());
              setCurrentMonth(weekStart.getMonth() + 1);
            }}
          >
            <WeekCard
              weekStart={weekStart}
              events={eventsByWeek[weekStartStr] || []}
              routines={routines}
              routineCompletions={routineCompletions}
              todos={todosByWeek[todoWeekStartStr] || []}
              dayDefinitions={dayDefinitions}
              selectedEventIds={selectedEventIdsByWeek[weekStartStr] || []}
              weekOrder={weekOrder}
              onDateClick={onDateClick}
              onEventClick={onEventClick}
              onEventDoubleClick={onEventDoubleClick}
              onDeleteEvent={onDeleteEvent}
              onToggleRoutine={onToggleRoutine}
              onAddTodo={onAddTodo}
              onToggleTodo={onToggleTodo}
              onUpdateTodo={onUpdateTodo}
              onDeleteTodo={onDeleteTodo}
              onSaveDayDefinition={onSaveDayDefinition}
              onDeleteDayDefinition={onDeleteDayDefinition}
              onOpenDiary={onOpenDiary}
              diaryCompletions={diaryCompletionMap}
              weekStatus={weekStatus}
              showRoutines={showRoutines}
              showTodos={showTodos}
            />
          </ObserverWrapper>
        </div>
      ))}
      <div ref={bottomSentinelRef} className={styles.appSentinel} />
    </div>
  );
});

export default App;