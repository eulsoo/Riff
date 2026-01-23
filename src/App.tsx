import { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
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
  deleteDuplicateEvents, getUserAvatar
} from './services/api';
import { syncSelectedCalendars, CalDAVConfig } from './services/caldav';
import { encryptData, decryptData } from './lib/crypto';

export interface Event {
  id: string;
  date: string;
  title: string;
  memo?: string;
  startTime?: string;
  endTime?: string;
  color: string;
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

  const formatLocalDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getWeekStartForDate = (date: Date) => {
    const weekStart = new Date(date);
    const dayOfWeek = weekStart.getDay();
    const diff = weekOrder === 'sun'
      ? -dayOfWeek
      : (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    weekStart.setDate(weekStart.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  };

  const getTodoWeekStart = (weekStart: Date) => {
    const base = new Date(weekStart);
    if (weekOrder === 'sun') {
      base.setDate(base.getDate() + 1); // 기존 투두는 월요일 기준으로 저장됨
    }
    return formatLocalDate(base);
  };

  const getCurrentTodoWeekStart = () => {
    const currentWeekStart = getWeekStartForDate(new Date());
    return getTodoWeekStart(currentWeekStart);
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
          setEvents(cached.events || []);
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
      setEvents(eventsData);
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

  const generateWeeks = () => {
    const weeks = [];
    const today = new Date();
    const currentWeekStart = new Date(today);
    const dayOfWeek = currentWeekStart.getDay();
    const diff = weekOrder === 'sun'
      ? -dayOfWeek
      : (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    currentWeekStart.setDate(currentWeekStart.getDate() + diff);

    // 과거 주간 생성 (역순으로 추가되지 않도록 계산 주의)
    for (let i = -pastWeeks; i < futureWeeks; i++) {
      const weekStart = new Date(currentWeekStart);
      weekStart.setDate(weekStart.getDate() + (i * 7));
      weeks.push(weekStart);
    }

    return weeks;
  };

  const weeks = generateWeeks();



  const getWeekStatus = (weekStart: Date): 'current' | 'prev' | 'next' | 'other' => {
    const today = new Date();
    const currentWeekStart = new Date(today);
    const dayOfWeek = currentWeekStart.getDay();
    const diff = weekOrder === 'sun'
      ? -dayOfWeek
      : (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    currentWeekStart.setDate(currentWeekStart.getDate() + diff);
    currentWeekStart.setHours(0, 0, 0, 0);

    const weekStartCopy = new Date(weekStart);
    weekStartCopy.setHours(0, 0, 0, 0);

    // 이번 주
    if (weekStartCopy.getTime() === currentWeekStart.getTime()) {
      return 'current';
    }

    // 지난 주
    const prevWeekStart = new Date(currentWeekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    if (weekStartCopy.getTime() === prevWeekStart.getTime()) {
      return 'prev';
    }

    // 다음 주
    const nextWeekStart = new Date(currentWeekStart);
    nextWeekStart.setDate(nextWeekStart.getDate() + 7);
    if (weekStartCopy.getTime() === nextWeekStart.getTime()) {
      return 'next';
    }

    return 'other';
  };

  const handleDateClick = (date: string) => {
    setSelectedDate(date);
    setIsEventModalOpen(true);
  };

  const handleAddEvent = async (event: Omit<Event, 'id'>) => {
    const newEvent = await createEvent(event);
    if (newEvent) {
      setEvents([...events, newEvent]);
      setIsEventModalOpen(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    const success = await deleteEvent(eventId);
    if (success) {
      setEvents(events.filter(e => e.id !== eventId));
      setSelectedEvent(prev => (prev?.id === eventId ? null : prev));
      setSelectedEventIds(prev => prev.filter(id => id !== eventId));
    }
  };

  const handleUpdateEvent = async (eventId: string, updates: Partial<Event>) => {
    const updated = await updateEvent(eventId, updates);
    if (updated) {
      setEvents(events.map(e => e.id === eventId ? updated : e));
      setSelectedEvent(prev => (prev?.id === eventId ? updated : prev));
    }
  };

  const handleDeleteSelectedEvents = async () => {
    if (selectedEventIds.length === 0) return;
    const idsToDelete = [...selectedEventIds];
    const results = await Promise.all(idsToDelete.map(id => deleteEvent(id)));
    const deletedIds = idsToDelete.filter((_, idx) => results[idx]);
    if (deletedIds.length > 0) {
      setEvents(events.filter(e => !deletedIds.includes(e.id)));
      setSelectedEvent(prev => (prev && deletedIds.includes(prev.id) ? null : prev));
      setSelectedEventIds(prev => prev.filter(id => !deletedIds.includes(id)));
    }
  };

  const handleAddRoutine = async (routine: Omit<Routine, 'id'>) => {
    const newRoutine = await createRoutine(routine);
    if (newRoutine) {
      setRoutines([...routines, newRoutine]);
    }
  };

  const handleDeleteRoutine = async (routineId: string) => {
    const success = await deleteRoutine(routineId);
    if (success) {
      setRoutines(routines.filter(r => r.id !== routineId));
      setRoutineCompletions(routineCompletions.filter(rc => rc.routineId !== routineId));
    }
  };

  const handleToggleRoutine = async (routineId: string, date: string) => {
    const existing = routineCompletions.find(
      rc => rc.routineId === routineId && rc.date === date
    );
    const completed = existing ? !existing.completed : true;

    const updated = await toggleRoutineCompletion(routineId, date, completed);
    if (updated) {
      if (existing) {
        setRoutineCompletions(
          routineCompletions.map(rc =>
            rc.routineId === routineId && rc.date === date
              ? updated
              : rc
          )
        );
      } else {
        setRoutineCompletions([...routineCompletions, updated]);
      }
    }
  };

  const handleAddTodo = async (weekStart: string, text: string) => {
    const newTodo = await createTodo({
      weekStart,
      text,
      completed: false,
    });
    if (newTodo) {
      setTodos([...todos, newTodo]);
    }
  };

  const handleToggleTodo = async (todoId: string) => {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    const updated = await updateTodo(todoId, { completed: !todo.completed });
    if (updated) {
      setTodos(todos.map(t => t.id === todoId ? updated : t));
    }
  };

  const handleUpdateTodo = async (todoId: string, text: string) => {
    const updated = await updateTodo(todoId, { text });
    if (updated) {
      setTodos(todos.map(t => t.id === todoId ? updated : t));
    }
  };

  const handleDeleteTodo = async (todoId: string) => {
    const success = await deleteTodo(todoId);
    if (success) {
      setTodos(todos.filter(t => t.id !== todoId));
    }
  };

  const handleSaveDayDefinition = async (date: string, text: string) => {
    const saved = await upsertDayDefinition(date, text);
    if (saved) {
      setDayDefinitions(prev => ({ ...prev, [date]: text }));
    }
  };

  const handleDeleteDayDefinition = async (date: string) => {
    const success = await deleteDayDefinition(date);
    if (success) {
      setDayDefinitions(prev => {
        const next = { ...prev };
        delete next[date];
        return next;
      });
    }
  };

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


  return (
    <div className={styles.app}>
      {/* 캘린더가 마운트된 경우에만 렌더링 */}
      {calendarMounted && (
        <div>
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

          {/* 주간 리스트 */}
          <div className={styles.appContent} ref={containerRef}>
            <div className={styles.appWeeksList}>
              {/* Top Sentinel for Infinite Scroll */}
              <div ref={topSentinelRef} className={styles.appSentinel} />

              {weeks.map((weekStart) => {
                const weekStatus = getWeekStatus(weekStart);
                const isCurrentWeek = weekStatus === 'current';
                // Use local date string instead of toISOString() to identify the week
                const weekStartStr = formatLocalDate(weekStart);
                const todoWeekStartStr = getTodoWeekStart(weekStart);

                return (
                  <div
                    key={weekStartStr}
                    id={isCurrentWeek ? 'current-week' : undefined}
                  >
                    <ObserverWrapper
                      onIntersect={() => {
                        setCurrentYear(weekStart.getFullYear());
                        setCurrentMonth(weekStart.getMonth() + 1);
                      }}
                    >
                      <WeekCard
                        weekStart={weekStart}
                        events={events}
                        routines={routines}
                        routineCompletions={routineCompletions}
                        todos={todos.filter(t => t.weekStart === todoWeekStartStr)}
                        dayDefinitions={dayDefinitions}
                        selectedEventIds={selectedEventIds}
                        weekOrder={weekOrder}
                        onDateClick={handleDateClick}
                        onEventClick={(event: Event, multi: boolean) => {
                          setSelectedEventIds(prev => {
                            if (multi) {
                              return prev.includes(event.id)
                                ? prev.filter(id => id !== event.id)
                                : [...prev, event.id];
                            }
                            return [event.id];
                          });
                        }}
                        onEventDoubleClick={(event: Event) => {
                          setSelectedEvent(event);
                          setSelectedEventIds([event.id]);
                        }}
                        onDeleteEvent={handleDeleteEvent}
                        onToggleRoutine={handleToggleRoutine}
                        onAddTodo={(text) => handleAddTodo(todoWeekStartStr, text)}
                        onToggleTodo={handleToggleTodo}
                        onUpdateTodo={handleUpdateTodo}
                        onDeleteTodo={handleDeleteTodo}
                        onSaveDayDefinition={handleSaveDayDefinition}
                        onDeleteDayDefinition={handleDeleteDayDefinition}
                        onOpenDiary={handleOpenDiary}
                        diaryCompletions={diaryCompletionMap}
                        weekStatus={weekStatus}
                        showRoutines={showRoutines}
                        showTodos={showTodos}
                      />
                    </ObserverWrapper>
                  </div>
                );
              })}

              {/* Bottom Sentinel for Infinite Scroll */}
              <div ref={bottomSentinelRef} className={styles.appSentinel} />
            </div>
          </div>

          <AppModals
            selectedDate={selectedDate}
            isEventModalOpen={isEventModalOpen}
            selectedEvent={selectedEvent}
            routines={routines}
            isRoutineModalOpen={isRoutineModalOpen}
            isCalDAVModalOpen={isCalDAVModalOpen}
            isSettingsModalOpen={isSettingsModalOpen}
            avatarUrl={avatarUrl}
            weekOrder={weekOrder}
            onCloseEventModal={() => setIsEventModalOpen(false)}
            onAddEvent={handleAddEvent}
            onCloseEventDetail={() => setSelectedEvent(null)}
            onUpdateEvent={handleUpdateEvent}
            onDeleteEvent={handleDeleteEvent}
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

    </div >
  );
}



export default App;