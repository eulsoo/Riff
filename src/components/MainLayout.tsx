import { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useWindowedSync, SyncRange } from '../hooks/useWindowedSync';
import { AppHeader } from './AppHeader';
import { CalendarList } from './CalendarList';
import { CalendarListPopup } from './CalendarListPopup';
import { useData } from '../contexts/DataContext';
import { useSelection, useHover } from '../contexts/SelectionContext';
import { useDrag } from '../contexts/DragContext';
import { useCalendarMetadata } from '../hooks/useCalendarMetadata';
import { WeekOrder, Event, DiaryEntry, Todo } from '../types';
import { normalizeCalendarUrl, CalendarMetadata, upsertDiaryEntry, getUserAvatar, getCalDAVSyncSettings } from '../services/api';
import { createCalDavEvent, updateCalDavEvent, deleteCalDavEvent, syncSelectedCalendars, CalDAVConfig, createRemoteCalendar, deleteRemoteCalendar, renameRemoteCalendar, getCalendars } from '../services/caldav';
import { getWeekStartForDate, getTodoWeekStart, formatLocalDate } from '../utils/dateUtils';
import { clearCachedGoogleToken } from '../lib/googleCalendar';
import { HistoryAction } from '../hooks/useUndoRedo';
import { ModalPosition } from './EventModal';
import { EmotionModal } from './EmotionModal';
import { ConfirmDialog } from './ConfirmDialog';
import styles from '../App.module.css';

const AppModals = lazy(() => import('./AppModals').then(module => ({ default: module.AppModals })));
const DiaryModal = lazy(() => import('./DiaryModal').then(module => ({ default: module.DiaryModal })));
const TimeSettingsModal = lazy(() => import('./TimeSettingsModal').then(module => ({ default: module.TimeSettingsModal })));
import { SubscribeModal } from './SubscribeModal';

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
    events, routines, routineCompletions, todos, diaryEntries, emotions,
    addEvent, updateEvent, deleteEvent,
    addRoutine, deleteRoutine, updateRoutine,
    fetchDiary, saveDiary, deleteDiary, setEmotion,
    loadData, // Add loadData for auto-sync refresh
    syncGoogleCalendar, isSyncingGoogle, googleCalendars, removeGoogleCalendar,
  } = useData();

  const {
    selectedEventIds, clearSelection,
    clipboardEvent, setClipboardEvent,
    activeDate, activeTimeSlot,
    setActiveDate, setActiveTimeSlot
  } = useSelection();
  const { endDrag, cancelDrag, dragStateRef, onBlockedDragRef } = useDrag();
  const { hoveredDate } = useHover();
  const {
    calendarMetadata,
    setCalendarMetadata,
    addLocalCalendar,
    updateLocalCalendar,
    convertLocalToCalDAV,
    convertCalDAVToLocal,
    deleteCalendar,
    refreshMetadata,
    refreshMetadataWithServerList
  } = useCalendarMetadata();

  const { recordAction, registerCategoryHandlers } = useData();

  const [isSyncEnabled, setIsSyncEnabled] = useState(false);
  // 앱 초기 로드 시 1회: 유령 캘린더 정리를 위한 메타데이터 검증
  const hasMetadataCheckedRef = useRef(false);

  // --- Robust Global Calendar Visibility ---
  const [hiddenCalendarUrls, setHiddenCalendarUrls] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('riffHiddenCalendars') || '[]'));
    } catch {
      return new Set();
    }
  });

  const visibleCalendarUrlSet = useMemo(() => {
    const urls = new Set<string>();
    calendarMetadata.forEach(c => {
      const u = normalizeCalendarUrl(c.url) || c.url;
      if (!hiddenCalendarUrls.has(u)) urls.add(u);
    });
    googleCalendars.forEach(c => {
      const u = c.googleCalendarId ? `google:${c.googleCalendarId}` : c.url;
      const norm = normalizeCalendarUrl(u) || u;
      if (!hiddenCalendarUrls.has(norm)) urls.add(norm);
    });
    return urls;
  }, [calendarMetadata, googleCalendars, hiddenCalendarUrls]);

  const toggleCalendarVisibility = useCallback((url: string) => {
    const norm = normalizeCalendarUrl(url) || url;
    setHiddenCalendarUrls(prev => {
      const next = new Set(prev);
      if (next.has(norm)) next.delete(norm);
      else next.add(norm);
      localStorage.setItem('riffHiddenCalendars', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  // --- CalDAV Sync Logic (Refactored using useWindowedSync) ---
  const onSync = useCallback(async (range: SyncRange, isManual: boolean) => {
    // 1. Check Settings & Metadata
    const settings = await getCalDAVSyncSettings();
    if (!settings) {
      if (isManual) console.log('Sync skipped: No settings found');
      return;
    }

    if (calendarMetadata.length === 0) {
      if (isManual) console.log('Sync skipped: No calendar metadata');
      return;
    }

    // 2. Filter Calendars
    const caldavCalendars = calendarMetadata.filter(c =>
      c.url.startsWith('http') && // Valid CalDAV URL must start with http/https
      !c.url.startsWith('local-') && !c.isSubscription && c.type !== 'subscription' && !c.url?.endsWith('.ics')
    );
    if (caldavCalendars.length === 0) return;

    if (isManual) {
      console.log('Starting windowed sync for:', caldavCalendars.map(c => c.displayName).join(', '));
    }

    // 3. Prepare Config
    const config: CalDAVConfig = {
      serverUrl: settings.serverUrl,
      username: settings.username,
      password: settings.password,
      settingId: settings.id
    };
    const caldavUrls = caldavCalendars.map(c => c.url);

    try {
      // 4. Execute Sync (Range provided by hook!)
      const forceFullSync = false;
      // Use the calculated range from the hook
      const count = await syncSelectedCalendars(config, caldavUrls, null, forceFullSync, range);

      if (count !== 0 || isManual) {
        if (isManual) console.log(`Sync complete. Reloading data...`);
        loadData(true);
      }

      // 5. 서버 캘린더 목록 확인 로직은 매번 Sync마다 수행하면 오버헤드 및 무한 리렌더링 위험이 있으므로,
      // 별도의 주기적 확인이나 초기화 단계로 이동하는 것이 좋음. 현재는 제거.
      // const hasCalDAVCalendars = ...
    } catch (error: any) {
      if (error?.message === 'Network is offline' || error?.code === 'OFFLINE') {
        console.log('Sync skipped (Offline)');
      } else {
        console.warn('Sync failed:', error);
      }
    }
  }, [calendarMetadata, loadData, refreshMetadataWithServerList]);

  // Use the reusable hook for Infinite Scroll & Windowed Fetching
  useWindowedSync({
    pastUnits: pastWeeks,
    futureUnits: futureWeeks,
    unitDays: 7,
    baseDate: getWeekStartForDate(new Date(), weekOrder),
    enabled: isSyncEnabled, // Only sync after metadata check
    onSync
  });





  // --- UI States ---
  const [isCalendarPopupOpen, setIsCalendarPopupOpen] = useState(false);

  // 캘린더 팝업 열릴 때 서버 목록과 비교해 자동으로 아이콘 상태 업데이트
  // (Mac Calendar에서 삭제된 캘린더 감지 → 평범한 로컬로 전환)
  const lastCalendarCheckRef = useRef<number>(0);
  useEffect(() => {
    if (!isCalendarPopupOpen) return;

    const COOLDOWN_MS = 60_000; // 60초 쿨다운
    const now = Date.now();
    if (now - lastCalendarCheckRef.current < COOLDOWN_MS) return;

    const hasCreatedFromApp = calendarMetadata.some(c => c.createdFromApp);
    if (!hasCreatedFromApp) return; // 체크할 캘린더 없으면 스킵

    lastCalendarCheckRef.current = now;

    (async () => {
      try {
        const settings = await getCalDAVSyncSettings();
        if (!settings) return;

        const config: CalDAVConfig = {
          serverUrl: settings.serverUrl,
          username: settings.username,
          password: settings.password,
          settingId: settings.id,
        };
        const serverCalendars = await getCalendars(config);
        const urlRemap = refreshMetadataWithServerList(serverCalendars); // displayName도 같이 전달

        // 이벤트 re-link (CalDAV URL → 새 로컬 URL)
        if (urlRemap.size > 0) {
          for (const [oldUrl, newLocalUrl] of urlRemap.entries()) {
            const { error } = await supabase
              .from('events')
              .update({ calendar_url: newLocalUrl })
              .eq('calendar_url', oldUrl);
            if (error) console.error(`[PopupCheck] Event re-link failed: ${oldUrl} →`, error);
          }
          loadData(true);
        }
      } catch (e) {
        console.warn('[PopupCheck] Server calendar check failed:', e);
      }
    })();
  }, [isCalendarPopupOpen, calendarMetadata, refreshMetadataWithServerList, loadData]);

  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSubscribeModalOpen, setIsSubscribeModalOpen] = useState(false);
  const [isCalDAVModalOpen, setIsCalDAVModalOpen] = useState(false);
  const [calDAVModalMode, setCalDAVModalMode] = useState<'sync' | 'auth-only'>('sync');
  const [isGoogleSyncModalOpen, setIsGoogleSyncModalOpen] = useState(false);
  const [pendingSyncCalendar, setPendingSyncCalendar] = useState<CalendarMetadata | null>(null);
  const [isRoutineModalOpen, setIsRoutineModalOpen] = useState(false);
  const [isTimeSettingsModalOpen, setIsTimeSettingsModalOpen] = useState(false);
  const [appTimezone, setAppTimezone] = useState(() => {
    const saved = localStorage.getItem('appTimezone');
    return saved || Intl.DateTimeFormat().resolvedOptions().timeZone;
  });
  const [autoTimezone, setAutoTimezone] = useState(() => {
    const saved = localStorage.getItem('autoTimezone');
    return saved !== 'false';
  });

  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [draftEvent, setDraftEvent] = useState<Partial<Event> | null>(null);
  const [activeDiaryDate, setActiveDiaryDate] = useState<string | null>(null);
  const [isDiaryModalOpen, setIsDiaryModalOpen] = useState(false);
  const [modalSessionId, setModalSessionId] = useState(0); // Add sessionId for re-mounting modal

  const [popupPosition, setPopupPosition] = useState<ModalPosition | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Emotion Modal State
  const [isEmotionModalOpen, setIsEmotionModalOpen] = useState(false);
  const [emotionModalPosition, setEmotionModalPosition] = useState<ModalPosition | null>(null);
  const [emotionModalDate, setEmotionModalDate] = useState<string | null>(null);

  const [showRoutines, setShowRoutines] = useState(true);
  const [showDiary, setShowDiary] = useState(true);
  const [showEmotion, setShowEmotion] = useState(true);
  const [showTodos, setShowTodos] = useState(true);

  // Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title?: string;
    message: string;
    onConfirm?: () => void;
  }>({ isOpen: false, message: '' });

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const userInitial = session.user?.email?.[0]?.toUpperCase() || 'U';

  // Calendar Delete Dialog State
  const [calDeleteState, setCalDeleteState] = useState<{
    isOpen: boolean;
    url: string;
    name: string;
    isCalDAV: boolean;
    isUnsync?: boolean;
  } | null>(null);
  const [calDeleteOption, setCalDeleteOption] = useState<'local' | 'remote'>('local');

  // Toast State
  const [toast, setToast] = useState<{ message: string; type: 'loading' | 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (toast && toast.type !== 'loading') {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // 구독 이벤트 드래그 시도 시 토스트 표시
  useEffect(() => {
    onBlockedDragRef.current = () => {
      setToast({ message: '구독 일정은 수정할 수 없습니다.', type: 'error' });
    };
  }, [onBlockedDragRef]);

  const containerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // Close profile menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isProfileMenuOpen && profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProfileMenuOpen]);

  // --- Initial Avatar Load ---
  useEffect(() => {
    async function loadAvatar() {
      if (session?.user) {
        const url = await getUserAvatar();
        if (url) {
          setAvatarUrl(url);
        }
      }
    }
    loadAvatar();
  }, [session]);

  // Handlers for AppHeader
  // 앱 초기 로드 시 1회: 유령 캘린더 정리를 위한 메타데이터 검증
  useEffect(() => {
    // 캘린더 메타데이터가 로드되지 않았으면 대기
    if (calendarMetadata.length === 0) return;

    // 이미 체크했으면 Sync 활성화
    if (hasMetadataCheckedRef.current) {
      if (!isSyncEnabled) setIsSyncEnabled(true);
      return;
    }

    // CalDAV 캘린더 확인
    const hasCalDAV = calendarMetadata.some(c =>
      !c.isLocal && !c.isSubscription && c.type !== 'subscription' && c.url.startsWith('http')
    );

    // CalDAV가 없으면 즉시 Sync 활성화
    if (!hasCalDAV) {
      setIsSyncEnabled(true);
      hasMetadataCheckedRef.current = true;
      return;
    }

    // CalDAV가 있으면 검증 후 활성화
    const checkMetadata = async () => {
      try {
        const settings = await getCalDAVSyncSettings();
        if (!settings) {
          setIsSyncEnabled(true);
          return;
        }

        const config: CalDAVConfig = {
          serverUrl: settings.serverUrl,
          username: settings.username,
          password: settings.password,
          settingId: settings.id
        };
        const serverCalendars = await getCalendars(config);
        const urlRemap = refreshMetadataWithServerList(serverCalendars); // displayName도 같이 전달

        // 이벤트 re-link: 로컬 전환된 캘린더의 이벤트 calendar_url 업데이트
        if (urlRemap.size > 0) {
          for (const [oldUrl, newLocalUrl] of urlRemap.entries()) {
            const { error } = await supabase
              .from('events')
              .update({ calendar_url: newLocalUrl })
              .eq('calendar_url', oldUrl);
            if (error) console.error(`[Metadata] Event re-link failed: ${oldUrl} →`, error);
            else console.log(`[Metadata] Re-linked events: ${oldUrl} → ${newLocalUrl}`);
          }
          loadData(true);
        }
      } catch (e) {
        console.warn('[MainLayout] Metadata validation failed:', e);
      } finally {
        setIsSyncEnabled(true);
      }
    };

    checkMetadata();
    hasMetadataCheckedRef.current = true;
  }, [calendarMetadata, refreshMetadataWithServerList, isSyncEnabled]);



  // Handlers for AppHeader
  const scrollToToday = useCallback(() => {
    const todayElement = document.getElementById('current-week');
    if (todayElement) {
      todayElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const handleLogout = useCallback(() => {
    clearCachedGoogleToken();
    supabase.auth.signOut();
  }, []);

  // Note: Initial load is now handled by useCalendarMetadata hook




  // --- Data Processing (Weeks, Events By Week) ---
  // --- Data Processing (Weeks, Events By Week) ---
  const filteredEvents = useMemo(() => {
    // 메타데이터에 등록된 캘린더 URL 집합 (DB 로딩 완료 후 채워짐)
    const knownUrls = new Set(calendarMetadata.map(c => normalizeCalendarUrl(c.url) || c.url));

    const list = events.filter(e => {
      if (selectedEvent && e.id === selectedEvent.id) return true;

      // Handle local events (no calendarUrl)
      if (!e.calendarUrl) return true;

      const normalizedUrl = normalizeCalendarUrl(e.calendarUrl!) || '';

      // 등록된 캘린더: 가시성 설정에 따라 필터링
      if (knownUrls.has(normalizedUrl)) {
        return visibleCalendarUrlSet.has(normalizedUrl);
      }

      // 미등록 캘린더 (DB 메타데이터 아직 로딩 중이거나 Google 캘린더 등):
      // 명시적으로 숨긴 경우만 제외, 나머지는 기본 표시
      return !hiddenCalendarUrls.has(normalizedUrl);
    }).map(e => {
      // 캘린더 메타데이터의 색상을 이벤트에 실시간 반영
      // (구독 캘린더 뿐 아니라 iCloud/로컬 캘린더 색상 변경도 즉시 적용)
      if (e.calendarUrl) {
        const cal = calendarMetadata.find(c => normalizeCalendarUrl(c.url) === normalizeCalendarUrl(e.calendarUrl));
        if (cal?.color) {
          return { ...e, color: cal.color };
        }
      }
      return e;
    });

    // Draft Event Injection
    if (draftEvent && draftEvent.date) {
      const temp: Event = {
        id: 'draft-preview',
        date: draftEvent.date, // Updates rely on this being current
        title: draftEvent.title || '새로운 일정',
        startTime: draftEvent.startTime,
        endTime: draftEvent.endTime,
        endDate: (draftEvent as any).endDate, // Pass endDate for multi-day
        color: draftEvent.color || '#B3E5FC',
        calendarUrl: draftEvent.calendarUrl || 'local',
        isLocal: true,
        // Spread any other properties if needed, but explicit is safer
      } as Event;
      return [...list, temp];
    }
    return list;
  }, [events, visibleCalendarUrlSet, selectedEvent, draftEvent, calendarMetadata, hiddenCalendarUrls]);



  // Use Memo for map creation
  const eventsByWeek = useMemo(() => {
    const map: Record<string, Event[]> = {};
    filteredEvents.forEach(e => {
      const startDate = new Date(e.date);
      const endDateStr = (e as any).endDate || e.date;
      const endDate = new Date(endDateStr);

      // Loop current date from start to end, strictly by week boundaries would be more efficient,
      // but iterating by day is safe and simple for finding all relevant weeks.
      // Optimization: Jump to next week start.

      let current = new Date(startDate);
      // Normalize current to start of its week to avoid unnecessary daily iterations
      const startWeek = getWeekStartForDate(current, weekOrder);

      // We'll iterate by weeks. 
      // Calculate the Last Week Start
      const lastWeekStart = getWeekStartForDate(new Date(endDate), weekOrder);

      let currentWeekStart = new Date(startWeek);

      while (currentWeekStart <= lastWeekStart) {
        const wKey = formatLocalDate(currentWeekStart);
        if (!map[wKey]) map[wKey] = [];

        // Dedup: Check if already added (e.g. if single event, logic is fine, but safe guard)
        if (!map[wKey].some(existing => existing.id === e.id)) {
          map[wKey].push(e);
        }

        // Move to next week
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
      }
    });

    // Sort events in each week
    Object.keys(map).forEach(key => {
      map[key].sort((a, b) => {
        // 1. Sort by Date first
        if (a.date !== b.date) return a.date.localeCompare(b.date);

        // 2. Sort by Start Time
        const timeA = a.startTime || '00:00';
        const timeB = b.startTime || '00:00';
        return timeA.localeCompare(timeB);
      });
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
        setPastWeeks(prev => prev + 12);
        if (containerRef.current) {
          prevScrollHeightRef.current = containerRef.current.scrollHeight;
        }
      }
    }, { root: null, rootMargin: '2000px 0px 0px 0px' });

    if (topSentinelRef.current) observer.observe(topSentinelRef.current);
    return () => observer.disconnect();
  }, [setPastWeeks]);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        setFutureWeeks(prev => prev + 12);
      }
    }, { root: null, rootMargin: '0px 0px 2000px 0px' });
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
  // --- Handlers ---
  const handleDateClick = useCallback((date: string, anchorEl?: HTMLElement, timeSlot?: 'am' | 'pm' | 'allday') => {
    // Toggle check: If clicking the same date while modal is open, close it.
    if (selectedDate === date && isEventModalOpen) {
      setIsEventModalOpen(false);
      setPopupPosition(null);
      setSelectedDate(null);
      return;
    }

    // Default times based on slot
    const defaultStart = timeSlot === 'pm' ? '13:00' : timeSlot === 'am' ? '09:00' : '';
    const defaultEnd = timeSlot === 'pm' ? '14:00' : timeSlot === 'am' ? '10:00' : '';

    setDraftEvent({ date, title: '', startTime: defaultStart, endTime: defaultEnd, color: '#B3E5FC' });
    setSelectedEvent(null);
    setSelectedDate(date);
    setIsEventModalOpen(true);
    setModalSessionId(prev => prev + 1);

    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      const isRightHalf = rect.left > window.innerWidth / 2;
      const gap = 12;
      const top = rect.top + window.scrollY;

      let left: number | undefined;
      let right: number | undefined;

      if (isRightHalf) {
        right = (document.documentElement.clientWidth - rect.left) + gap;
      } else {
        left = rect.right + gap;
      }

      setPopupPosition({ top, left, right, align: isRightHalf ? 'right' : 'left' });
    } else {
      setPopupPosition(null);
    }
  }, [selectedDate, isEventModalOpen]);

  // --- Scrolled Center Point Detection Logic ---
  useEffect(() => {
    let ticking = false;

    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          // Use Window Viewport Center
          const centerX = window.innerWidth / 2;
          const centerY = window.innerHeight / 2;

          // Find element at viewport center
          const el = document.elementFromPoint(centerX, centerY);
          const weekEl = el?.closest('[data-week-id]'); // WeekCard has data-week-id="YYYY-MM-DD"

          if (weekEl) {
            const weekId = weekEl.getAttribute('data-week-id');
            if (weekId) {
              const [yStr, mStr] = weekId.split('-');
              const year = parseInt(yStr, 10);
              const month = parseInt(mStr, 10);

              setCurrentYear(year);
              setCurrentMonth(month);
            }
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleEventDoubleClick = useCallback((event: Event, anchorEl?: HTMLElement) => {
    setSelectedEvent(event);
    setSelectedDate(event.date);
    setIsEventModalOpen(true);
    setModalSessionId(prev => prev + 1);



    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      const isRightHalf = rect.left > window.innerWidth / 2;
      const gap = 12;
      const top = rect.top + window.scrollY;

      let left: number | undefined;
      let right: number | undefined;

      if (isRightHalf) {
        right = (document.documentElement.clientWidth - rect.left) + gap;
      } else {
        left = rect.right + gap;
      }

      setPopupPosition({ top, left, right, align: isRightHalf ? 'right' : 'left' });
    } else {
      setPopupPosition(null);
    }
  }, []);

  const handleAddEventWrapper = useCallback(async (event: Partial<Event>, keepOpen?: boolean, skipRecord = false) => {
    let eventToSave = { ...event };

    // Generate UID if missing to ensure consistency between Local DB and CalDAV Server
    if (!eventToSave.caldavUid) {
      eventToSave.caldavUid = crypto.randomUUID().toUpperCase();
    }
    eventToSave.source = 'caldav'; // Assume success initially for optimistic UI

    // 1. Optimistic Update: Save locally first
    // Cast to any to bypass strict type check for now or update addEvent signature
    const newEvent = await addEvent(eventToSave as Event);

    // 2. Background Sync
    if (newEvent) {
      if (newEvent.calendarUrl) {
        // Update visibility immediately
        setHiddenCalendarUrls(prev => {
          if (prev.has(newEvent.calendarUrl!)) {
            const next = new Set(prev);
            next.delete(newEvent.calendarUrl!);
            localStorage.setItem('riffHiddenCalendars', JSON.stringify(Array.from(next)));
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
      setDraftEvent(prev => (prev && prev.date === newEvent.date ? null : prev));

      // 3. Perform CalDAV Sync in background
      (async () => {
        try {
          if (event.calendarUrl) {
            const calMeta = calendarMetadata.find(c => normalizeCalendarUrl(c.url) === normalizeCalendarUrl(event.calendarUrl));
            const isGoogleCalendar = event.calendarUrl.startsWith('google:');
            const isCalDavCalendar = calMeta?.type === 'caldav'
              || (event.calendarUrl && (event.calendarUrl.includes('caldav') || event.calendarUrl.includes('icloud')));

            if (isGoogleCalendar) {
              if (calMeta?.readOnly) {
                console.warn('Skipping Google create: Calendar is read-only', event.calendarUrl);
              } else {
                try {
                  const { getGoogleProviderToken, uploadEventToGoogle } = await import('../lib/googleCalendar');
                  const token = await getGoogleProviderToken();
                  if (token) {
                    const calId = event.calendarUrl.replace('google:', '');
                    console.log('Syncing to Google Calendar (Create - Background)...', event.title);
                    const gId = await uploadEventToGoogle(token, calId, newEvent);
                    if (gId) {
                      await updateEvent(newEvent.id, { caldavUid: gId });
                    } else {
                      console.error('Google Calendar creation failed (Background)');
                    }
                  }
                } catch (e) {
                  console.error('Google Sync Create Error (Background):', e);
                }
              }
            } else if (isCalDavCalendar) {
              if (calMeta?.readOnly) {
                console.warn('Skipping CalDAV create: Calendar is read-only', event.calendarUrl);
              } else {
                const settings = await getCalDAVSyncSettings();
                if (settings) {
                  const config: CalDAVConfig = {
                    serverUrl: settings.serverUrl,
                    username: settings.username,
                    password: settings.password,
                    settingId: settings.id
                  };

                  console.log('Syncing to CalDAV (Background)...', eventToSave.title);
                  const { success } = await createCalDavEvent(config, event.calendarUrl!, eventToSave);

                  if (!success) {
                    console.error('CalDAV creation failed (Background)');
                    // Optional: Mark event as 'sync-failed' in local DB or notify user
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error('Remote Sync Error (Background):', e);
        }
      })();
    }

    // Return immediately (newEvent is already created)
    // Record Action for Undo
    if (newEvent && !skipRecord) {
      // Must use newEvent as it contains the real ID
      recordAction({ category: 'event', type: 'CREATE', event: newEvent });
    }
    return;
  }, [addEvent, recordAction]);

  const handleDeleteEventWrapper = useCallback(async (eventId: string, skipRecord = false) => {
    const eventToDelete = events.find(e => e.id === eventId);

    // Check if it's a subscription event
    if (eventToDelete?.calendarUrl) {
      const calMeta = calendarMetadata.find(c => normalizeCalendarUrl(c.url) === normalizeCalendarUrl(eventToDelete.calendarUrl!));
      if (calMeta && (calMeta.type === 'subscription' || calMeta.isSubscription || calMeta.url.includes('holidays') || calMeta.url.endsWith('.ics'))) {
        setToast({ message: '구독한 캘린더의 일정은 변경/삭제할 수 없습니다.', type: 'error' });
        return;
      }
    }

    // 1. Optimistic Delete: Remove from local DB and UI immediately
    const success = await deleteEvent(eventId);
    if (success) {
      if (selectedEvent?.id === eventId) setSelectedEvent(null);
      setToast({ message: '일정이 삭제되었습니다.', type: 'success' });
      // Assuming removeIdFromSelection is a function from SelectionContext
      // If not, it needs to be defined or removed.
      // For now, commenting out as it's not provided in the context.
      // removeIdFromSelection(eventId);
    }

    // 2. Background Sync (CalDAV)
    if (eventToDelete?.calendarUrl && eventToDelete.caldavUid) {
      // Run in background without awaiting
      (async () => {
        const calendarUrl = eventToDelete.calendarUrl!;
        const calMeta = calendarMetadata.find(c => normalizeCalendarUrl(c.url) === normalizeCalendarUrl(calendarUrl));

        const isGoogleCalendar = calendarUrl.startsWith('google:');
        const isCalDavCalendar = calMeta?.type === 'caldav'
          || (calendarUrl && (calendarUrl.includes('caldav') || calendarUrl.includes('icloud')));

        if (isGoogleCalendar) {
          if (calMeta?.readOnly) {
            console.warn('Skipping Google delete: Calendar is read-only', calendarUrl);
          } else {
            try {
              const { getGoogleProviderToken, deleteEventFromGoogle } = await import('../lib/googleCalendar');
              const token = await getGoogleProviderToken();
              if (token && eventToDelete.caldavUid) {
                const calId = calendarUrl.replace('google:', '');
                console.log('Syncing to Google Calendar (Delete - Background)...', eventToDelete.title);
                const gSuccess = await deleteEventFromGoogle(token, calId, eventToDelete.caldavUid);
                if (!gSuccess) {
                  console.error('Google deletion failed (Background)');
                }
              }
            } catch (e) {
              console.error('Google Delete Error (Background):', e);
            }
          }
        } else if (isCalDavCalendar) {
          if (calMeta?.readOnly) {
            console.warn('Skipping CalDAV delete: Calendar is read-only', calendarUrl);
          } else {
            try {
              const settings = await getCalDAVSyncSettings();
              if (settings) {
                const config: CalDAVConfig = {
                  serverUrl: settings.serverUrl,
                  username: settings.username,
                  password: settings.password,
                  settingId: settings.id
                };
                console.log('Syncing to CalDAV (Delete - Background)...', eventToDelete.title);
                const { success: caldavSuccess } = await deleteCalDavEvent(config, calendarUrl, eventToDelete.caldavUid!);

                if (!caldavSuccess) {
                  console.error('CalDAV deletion failed (Background)');
                }
              }
            } catch (e) {
              console.error('CalDAV Delete Error (Background):', e);
            }
          }
        }
      })();
    } else if (eventToDelete?.calendarUrl && !eventToDelete.caldavUid) {
      console.warn('UID missing for CalDAV event, skipping remote delete', eventToDelete);
    }

    if (success && eventToDelete && !skipRecord) {
      recordAction({ category: 'event', type: 'DELETE', event: eventToDelete });
    }
  }, [deleteEvent, selectedEvent, events, calendarMetadata, recordAction]); // removeIdFromSelection removed from dependency array

  const handleUpdateEventWrapper = useCallback(async (eventId: string, updates: Partial<Event>, skipRecord = false) => {
    const oldEvent = events.find(e => e.id === eventId);
    if (!oldEvent) return;

    // Check if it's a subscription event
    if (oldEvent.calendarUrl) {
      const calMeta = calendarMetadata.find(c => normalizeCalendarUrl(c.url) === normalizeCalendarUrl(oldEvent.calendarUrl!));
      if (calMeta && (calMeta.type === 'subscription' || calMeta.isSubscription || calMeta.url.includes('holidays') || calMeta.url.endsWith('.ics'))) {
        setToast({ message: '구독한 캘린더의 일정은 변경/삭제할 수 없습니다.', type: 'error' });
        return;
      }
    }

    // 1. Optimistic Local Update
    await updateEvent(eventId, updates);

    // Optimistic UI update for selected event
    if (selectedEvent?.id === eventId) {
      setSelectedEvent(prev => prev ? { ...prev, ...updates } : null);
    }

    // 2. Background Sync (CalDAV)
    const targetCalendarUrl = updates.calendarUrl || oldEvent.calendarUrl;

    if (targetCalendarUrl) {
      // Fire and Forget
      (async () => {
        try {
          const calMeta = calendarMetadata.find(c => normalizeCalendarUrl(c.url) === normalizeCalendarUrl(targetCalendarUrl));
          const isGoogleCalendar = targetCalendarUrl.startsWith('google:');
          const isCalDavCalendar = calMeta?.type === 'caldav'
            || (targetCalendarUrl && (targetCalendarUrl.includes('caldav') || targetCalendarUrl.includes('icloud')));

          const uid = updates.caldavUid || oldEvent.caldavUid;
          const mergedEvent = { ...oldEvent, ...updates };

          if (isGoogleCalendar && uid) {
            if (calMeta?.readOnly) {
              console.warn('Skipping Google update: Calendar is read-only', targetCalendarUrl);
            } else {
              try {
                const { getGoogleProviderToken, updateEventInGoogle } = await import('../lib/googleCalendar');
                const token = await getGoogleProviderToken();
                if (token) {
                  const calId = targetCalendarUrl.replace('google:', '');
                  console.log('Syncing to Google Calendar (Update - Background)...', mergedEvent.title);

                  // For move operation you'd need delete then create, but for simplicity of same-calendar updates:
                  const isMovingCalendar = updates.calendarUrl && normalizeCalendarUrl(updates.calendarUrl) !== normalizeCalendarUrl(oldEvent.calendarUrl || '');

                  if (isMovingCalendar && oldEvent.calendarUrl && oldEvent.calendarUrl.startsWith('google:')) {
                    // Advanced: Handling move between two google calendars
                    const { deleteEventFromGoogle, uploadEventToGoogle } = await import('../lib/googleCalendar');
                    await deleteEventFromGoogle(token, oldEvent.calendarUrl.replace('google:', ''), uid);
                    await uploadEventToGoogle(token, calId, mergedEvent);
                  } else {
                    // Regular update (or update in new system if moved from CalDAV to Google, handled as pure override)
                    const success = await updateEventInGoogle(token, calId, uid, mergedEvent);
                    if (!success) {
                      console.error('Google update failed');
                    }
                  }
                }
              } catch (e) {
                console.error('Google Update Error (Background):', e);
              }
            }
          } else if (isCalDavCalendar && uid) {
            if (calMeta?.readOnly) {
              console.warn('Skipping CalDAV update: Calendar is read-only', targetCalendarUrl);
            } else {
              const settings = await getCalDAVSyncSettings();
              if (settings) {
                const config: CalDAVConfig = {
                  serverUrl: settings.serverUrl,
                  username: settings.username,
                  password: settings.password,
                  settingId: settings.id
                };

                const isMovingCalendar = updates.calendarUrl && normalizeCalendarUrl(updates.calendarUrl) !== normalizeCalendarUrl(oldEvent.calendarUrl || '');

                if (isMovingCalendar && oldEvent.calendarUrl) {
                  console.log(`Moving event ${uid} from ${oldEvent.calendarUrl} to ${targetCalendarUrl}`);
                  const { success: deleteSuccess } = await deleteCalDavEvent(config, oldEvent.calendarUrl, uid);
                  if (!deleteSuccess) console.error('CalDAV Move: Failed to delete from old calendar', oldEvent.calendarUrl);

                  const { success: createSuccess } = await createCalDavEvent(config, targetCalendarUrl, mergedEvent);
                  if (!createSuccess) console.error('CalDAV Move: Failed to create in new calendar', targetCalendarUrl);
                } else {
                  console.log(`Updating event ${uid} in ${targetCalendarUrl}`);
                  const { success } = await updateCalDavEvent(config, targetCalendarUrl, uid, mergedEvent);
                  if (!success) console.error('CalDAV update failed');
                }
              }
            }
          }
        } catch (e) {
          console.error('Remote Background Update Error:', e);
        }
      })();
    }

    // Record Action for Undo
    if (oldEvent && !skipRecord) {
      const newEventFull = { ...oldEvent, ...updates };
      recordAction({ category: 'event', type: 'UPDATE', prevEvent: oldEvent, event: newEventFull });
    }
  }, [updateEvent, selectedEvent, events, calendarMetadata, recordAction]);

  // Register Undo/Redo Handlers for Events
  useEffect(() => {
    registerCategoryHandlers(
      'event',
      async (action: HistoryAction) => {
        // Undo Logic
        if (action.type === 'CREATE' && action.event) {
          await handleDeleteEventWrapper(action.event.id, true);
        } else if (action.type === 'DELETE' && action.event) {
          await handleAddEventWrapper(action.event, false, true);
        } else if (action.type === 'UPDATE' && action.event && action.prevEvent) {
          await handleUpdateEventWrapper(action.event.id, action.prevEvent, true);
        }
      },
      async (action: HistoryAction) => {
        // Redo Logic
        if (action.type === 'CREATE' && action.event) {
          await handleAddEventWrapper(action.event, false, true);
        } else if (action.type === 'DELETE' && action.event) {
          await handleDeleteEventWrapper(action.event.id, true);
        } else if (action.type === 'UPDATE' && action.event) {
          await handleUpdateEventWrapper(action.event.id, action.event, true);
        }
      }
    );
  }, [registerCategoryHandlers, handleAddEventWrapper, handleDeleteEventWrapper, handleUpdateEventWrapper]);

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

  const handleDraftUpdateWrapper = useCallback((updates: Partial<Event>) => {
    setDraftEvent(prev => prev ? { ...prev, ...updates } : updates);
  }, []);

  const handleOpenEmotion = useCallback((date: string, anchorEl: HTMLElement) => {
    if (!containerRef.current) return;

    // containerRef가 스크롤 영역이므로 그 내부 기준의 위치를 구해야 스크롤해도 팝업이 같이 움직임
    const containerRect = containerRef.current.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();

    // calculate top/left relative to container content
    let top = anchorRect.top - containerRect.top + containerRef.current.scrollTop + 30;

    // Position logic to avoid overflow or adjust nicely
    setEmotionModalPosition({ top, left: anchorRect.left - containerRect.left + 10, align: 'left' });
    setEmotionModalDate(date);
    setIsEmotionModalOpen(true);
  }, []);

  const activeDiaryEntry = activeDiaryDate ? diaryEntries[activeDiaryDate] : undefined;

  const activeDiaryEvents = useMemo(() => {
    if (!activeDiaryDate) return [];
    return events.filter(e => e.date === activeDiaryDate);
  }, [events, activeDiaryDate]);

  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-date-allday]') && !target.closest('[data-date-am]') && !target.closest('[data-date-pm]')) {
      setActiveDate(null);
      setActiveTimeSlot(null);
    }

    // If event bubbled up here, it means it wasn't handled by specific elements (like EventItem)
    // so we clear selection.
    if (selectedEventIds.length > 0) {
      clearSelection();
    }
    // Note: We don't clear selectedEvent (modal state) here instantly because
    // usually clicking background doesn't close modal unless it's the modal backdrop.
    // But user request was "deselect" which usually refers to the highlighted selection.
  }, [selectedEventIds, clearSelection, setActiveDate, setActiveTimeSlot]);

  // 전역 마우스업: 드래그 드롭 확정 (ref 기반으로 stale closure 방지)
  const handleUpdateEventWrapperRef = useRef(handleUpdateEventWrapper);
  useEffect(() => { handleUpdateEventWrapperRef.current = handleUpdateEventWrapper; });

  useEffect(() => {
    const handleMouseUp = () => {
      // dragStateRef.current로 동기적 철야 - 항상 최신 값을 반영
      if (!dragStateRef.current) return;
      endDrag(handleUpdateEventWrapperRef.current);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragStateRef.current) {
        cancelDrag();
      }
    };
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
    };
    // endDrag/cancelDrag는 안정적 (deps 목록 최소화)
  }, [endDrag, cancelDrag, dragStateRef]);

  const handleDeleteCalendar = useCallback((url: string, actionType?: 'unsync' | 'delete') => {
    if (url.startsWith('google:')) {
      // 1. 구글 캘린더 동기화 해제
      const id = url.replace('google:', '');
      removeGoogleCalendar(id);

      // 2. 로컬DB의 구글 캐시 내역 정리
      (async () => {
        const { error } = await supabase.from('events').delete().eq('calendar_url', url);
        if (error) console.error('Failed to cleanup google local events', error);
        loadData(true);
      })();
      setToast({ message: '구글 캘린더 동기화가 해제되었습니다.', type: 'success' });
      return;
    }

    const calendar = calendarMetadata.find(c => c.url === url);
    if (!calendar) return;

    if (actionType === 'unsync') {
      setCalDeleteState({
        isOpen: true,
        url,
        name: calendar.displayName || '캘린더',
        isCalDAV: true, // For UI purposes
        isUnsync: true
      });
      return;
    }

    setCalDeleteOption('local'); // Reset default option
    setCalDeleteState({
      isOpen: true,
      url,
      name: calendar.displayName || '캘린더',
      isCalDAV: !calendar.isLocal && !calendar.readOnly && !calendar.isSubscription && calendar.type !== 'subscription',
      isUnsync: false
    });
  }, [calendarMetadata, removeGoogleCalendar, loadData]);

  const handleConfirmDelete = useCallback(async () => {
    if (!calDeleteState) return;
    const { url, isCalDAV, isUnsync } = calDeleteState;

    // Close dialog
    setCalDeleteState(null);

    if (isUnsync) {
      // 동기화 해제: CalDAV 캘린더 → 로컬 캘린더로 전환 (삭제 아님)
      // convertCalDAVToLocal이 새 로컬 URL을 반환
      const newLocalUrl = convertCalDAVToLocal(url);

      // 해당 캘린더의 이벤트 calendar_url을 새 로컬 URL로 일괄 업데이트
      (async () => {
        try {
          const { error } = await supabase
            .from('events')
            .update({ calendar_url: newLocalUrl })
            .eq('calendar_url', url);
          if (error) console.error('Failed to re-link events after unsync:', error);
          // 정규화된 URL로도 시도 (iCloud URL은 trailing slash 등 차이가 있을 수 있음)
          const normUrl = normalizeCalendarUrl(url);
          if (normUrl && normUrl !== url) {
            await supabase
              .from('events')
              .update({ calendar_url: newLocalUrl })
              .eq('calendar_url', normUrl);
          }
          loadData(true);
        } catch (e) {
          console.error('Unsync event re-link error:', e);
        }
      })();

      setToast({ message: '동기화가 해제되었습니다. 캘린더는 Riff에 유지됩니다.', type: 'success' });
      return;
    }

    const deleteFromServer = isCalDAV && calDeleteOption === 'remote';
    await executeDeleteCalendar(url, deleteFromServer);
  }, [calDeleteState, calDeleteOption, convertCalDAVToLocal, loadData]);

  const executeDeleteCalendar = async (url: string, deleteFromServer: boolean) => {
    if (deleteFromServer) {
      try {
        const settings = await getCalDAVSyncSettings();
        if (settings) {
          const config: CalDAVConfig = {
            serverUrl: settings.serverUrl,
            username: settings.username,
            password: settings.password,
            settingId: settings.id
          };
          await deleteRemoteCalendar(config, url);
        }
      } catch (e) {
        console.error("서버 캘린더 삭제 실패:", e);
        alert(`서버 캘린더 삭제 중 오류가 발생했습니다.\n목록에서만 제거됩니다.\n${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 3. 로컬 목록 및 데이터 제거
    deleteCalendar(url);

    const normalizedUrl = normalizeCalendarUrl(url);
    if (normalizedUrl) {
      const { error } = await supabase.from('events').delete().eq('calendar_url', normalizedUrl);
      if (error) console.error('Failed to delete events for calendar', url, error);

      // Reset holiday sync flag if it's the holiday calendar
      if (url.includes('holidays/kr_ko.ics')) {
        localStorage.removeItem('holiday_synced_v2');
      }
    }
  };

  // --- Sync Local Calendar to Mac/iCloud ---
  const handleSyncToMac = useCallback(async (calendar: CalendarMetadata) => {
    try {
      // 1. CalDAV 설정 확인
      const savedSettings = await getCalDAVSyncSettings();
      if (!savedSettings?.serverUrl || !savedSettings?.username) {
        setPendingSyncCalendar(calendar);
        setCalDAVModalMode('auth-only');
        setIsCalDAVModalOpen(true);
        // 설정이 완료된 후 다시 이 함수가 호출되지는 않으므로, 
        // 사용자가 다시 '맥 캘린더 생성'을 눌러야 함을 알리는 Toast를 띄울 수도 있지만,
        // 일단 UI 흐름을 단순화하기 위해 바로 모달만 띄움.
        return;
      }

      const config: CalDAVConfig = {
        serverUrl: savedSettings.serverUrl,
        username: savedSettings.username,
        password: savedSettings.password,
        settingId: savedSettings.id,
      };

      // 2. 백그라운드에서 원격 캘린더 생성 (Toast로 피드백)
      setToast({ message: 'Mac 캘린더에 추가 중...', type: 'loading' });
      // 캘린더 팝업을 닫고 싶은 경우 여기서 닫을 수 있음 (setIsCalendarPopupOpen(false)) - 사용자 선택

      try {
        const result = await createRemoteCalendar(config, calendar.displayName, calendar.color);

        if (result.success) {
          // 3. 로컬 캘린더를 CalDAV 캘린더로 변환
          const newCalendar = {
            url: result.calendarUrl,
            displayName: result.displayName,
            color: result.color,
            isVisible: true,
            isLocal: false,
            type: 'caldav' as const,
            createdFromApp: true,
          };

          convertLocalToCalDAV(calendar.url, newCalendar);

          setHiddenCalendarUrls(prev => {
            if (prev.has(calendar.url) || prev.has(result.calendarUrl)) {
              const next = new Set(prev);
              next.delete(result.calendarUrl); // ensure new is visible
              // if old was hidden, maybe hide new instead? No, if user syncs to Mac, they probably want to see it.
              localStorage.setItem('riffHiddenCalendars', JSON.stringify(Array.from(next)));
              return next;
            }
            return prev;
          });

          // 성공 Toast (팝업 대신)
          setToast({ message: 'Mac 캘린더에 추가되었습니다.', type: 'success' });
        }
      } catch (error) {
        console.error('Mac 캘린더 생성 실패:', error);
        setToast(null); // 로딩 Toast 제거
        setConfirmDialog({
          isOpen: true,
          title: '오류',
          message: `Mac 캘린더 생성 실패: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } catch (e) {
      console.error('Sync failed:', e);
      setToast(null);
      alert('동기화 중 오류가 발생했습니다.');
    }
  }, [getCalDAVSyncSettings, convertLocalToCalDAV]);

  // --- Keyboard Selection Delete ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 입력 필드 포커스 시 무시
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEventIds.length > 0) {
        e.preventDefault(); // 백스페이스로 페이지 뒤로가기 방지

        // Prevent deleting subscription events via keyboard
        const validIdsToDelete = selectedEventIds.filter(id => {
          const event = events.find(ev => ev.id === id);
          if (event?.calendarUrl) {
            const calMeta = calendarMetadata.find(c => normalizeCalendarUrl(c.url) === normalizeCalendarUrl(event.calendarUrl!));
            if (calMeta && (calMeta.type === 'subscription' || calMeta.isSubscription || calMeta.url.includes('holidays') || calMeta.url.endsWith('.ics'))) {
              return false;
            }
          }
          return true;
        });

        if (validIdsToDelete.length < selectedEventIds.length) {
          setToast({ message: '구독한 캘린더의 일정은 변경/삭제할 수 없습니다.', type: 'error' });
        }

        if (validIdsToDelete.length > 0) {
          Promise.all(validIdsToDelete.map(id => handleDeleteEventWrapper(id)));
        }
        clearSelection();
      }

      // Copy (Cmd/Ctrl + C)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        if (selectedEventIds.length > 0) {
          const eventToCopy = events.find(ev => ev.id === selectedEventIds[0]);
          if (eventToCopy) {
            setClipboardEvent(eventToCopy);
            console.log('Event copied:', eventToCopy.title);
          }
        }
      }

      // Paste (Cmd/Ctrl + V)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        if (clipboardEvent && hoveredDate) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, caldavUid, ...rest } = clipboardEvent; // Remove ID and UID to create new event
          handleAddEventWrapper({
            ...rest,
            date: hoveredDate,
            // Keep original times and props
          });
          console.log(`Event pasted to ${hoveredDate}`);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEventIds, handleDeleteEventWrapper, clearSelection, events, clipboardEvent, setClipboardEvent, hoveredDate, addEvent]);

  return (
    <div className={styles.appLayout}>

      <AppHeader
        isCalendarPopupOpen={isCalendarPopupOpen}
        onToggleCalendarPopup={() => setIsCalendarPopupOpen(!isCalendarPopupOpen)}
        calendarPopupNode={
          isCalendarPopupOpen ? (
            <CalendarListPopup
              calendars={[...calendarMetadata, ...googleCalendars]}
              visibleUrlSet={visibleCalendarUrlSet}
              onToggle={toggleCalendarVisibility}
              onClose={() => setIsCalendarPopupOpen(false)}
              onAddLocalCalendar={addLocalCalendar}
              onUpdateLocalCalendar={async (url, updates) => {
                // 1. Riff 로컬 상태 업데이트 (즉시)
                updateLocalCalendar(url, updates);

                // 2. displayName이 바뀌었고, CalDAV 동기화 중인 캘린더라면 서버에도 반영
                if (updates.displayName) {
                  const cal = calendarMetadata.find(c => c.url === url);
                  const isCalDAVSynced = cal && cal.createdFromApp && !cal.isLocal && cal.url.startsWith('http');
                  if (isCalDAVSynced) {
                    try {
                      const settings = await getCalDAVSyncSettings();
                      if (settings) {
                        const config: CalDAVConfig = {
                          serverUrl: settings.serverUrl,
                          username: settings.username,
                          password: settings.password,
                          settingId: settings.id,
                        };
                        await renameRemoteCalendar(config, url, updates.displayName);
                        console.log(`[Rename] Mac Calendar에 이름 반영: ${updates.displayName}`);
                      }
                    } catch (e) {
                      console.warn('[Rename] 서버 이름 변경 실패 (로컴에는 저장됨):', e);
                    }
                  }
                }
              }}
              onDeleteCalendar={handleDeleteCalendar}
              onSyncToMac={handleSyncToMac}
              onOpenCalDAVModal={() => {
                setCalDAVModalMode('sync');
                setIsCalDAVModalOpen(true);
              }}
              onOpenSubscribeModal={() => {
                setIsSubscribeModalOpen(true);
              }}
              onOpenGoogleSync={() => setIsGoogleSyncModalOpen(true)}
              isSyncingGoogle={isSyncingGoogle}
              onShowToast={(message, type) => setToast({ message, type })}
            />
          ) : undefined
        }
        currentYear={currentYear}
        currentMonth={currentMonth}
        avatarUrl={avatarUrl}
        userInitial={userInitial}
        isProfileMenuOpen={isProfileMenuOpen}
        profileMenuRef={profileMenuRef}
        onScrollToToday={scrollToToday}
        onAddSchedule={() => {
          let dateToUse = activeDate;

          if (!dateToUse) {
            // 빈 공간 클릭이나 선택 해제 등으로 activeDate가 없을 때
            // 화면상에 날짜(dayMeta)가 가려지지 않고 온전히 보이는 첫 번째 날짜 요소를 찾습니다.
            const dayMetas = Array.from(document.querySelectorAll('[data-date-allday]')) as HTMLElement[];
            // 상단 헤더 높이가 대략 60~65px 이므로, 70px 이상이면 가려지지 않고 보인다고 판단.
            const visibleMeta = dayMetas.find(el => el.getBoundingClientRect().top > 70);

            if (visibleMeta) {
              // 그 요소가 속한 주간(weekCard) 전체를 가져옵니다.
              const weekCard = visibleMeta.closest('[data-week-id]');
              if (weekCard) {
                // 해당 주간에 속한 모든 날짜들을 시도하여 월요일(getDay() === 1)을 찾습니다.
                const weekMetas = Array.from(weekCard.querySelectorAll('[data-date-allday]')) as HTMLElement[];
                for (const meta of weekMetas) {
                  const dateStr = meta.getAttribute('data-date-allday');
                  if (dateStr) {
                    const [y, m, d] = dateStr.split('-').map(Number);
                    const dateObj = new Date(y, m - 1, d);
                    if (dateObj.getDay() === 1) { // 1 = 월요일
                      dateToUse = dateStr;
                      break;
                    }
                  }
                }
              }
            }
          }

          if (!dateToUse) {
            // 만약 뭔가 잘못되어 화면에서 월요일을 찾지 못했다면(예: 매우 좁은 주간 등), 오늘로 폴백합니다.
            const today = new Date();
            dateToUse = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          }

          const slotToUse = (activeDate && activeTimeSlot) ? activeTimeSlot : 'am';
          const alignEl = document.querySelector(`[data-date-${slotToUse}="${dateToUse}"]`) as HTMLElement | null;
          handleDateClick(dateToUse, alignEl ?? undefined, slotToUse);
        }}
        onToggleProfileMenu={() => setIsProfileMenuOpen(p => !p)}
        onLogout={handleLogout}

        onOpenRoutine={() => {
          setIsProfileMenuOpen(false);
          setIsSettingsModalOpen(false);
          setIsTimeSettingsModalOpen(false);
          setIsRoutineModalOpen(true);
        }}
        showRoutines={showRoutines}
        onToggleRoutines={() => setShowRoutines(p => !p)}
        showDiary={showDiary}
        onToggleDiary={() => setShowDiary(p => !p)}
        showEmotion={showEmotion}
        onToggleEmotion={() => setShowEmotion(p => !p)}
        showTodos={showTodos}
        onToggleTodos={() => setShowTodos(p => !p)}
        onOpenSettings={() => {
          setIsProfileMenuOpen(false);
          setIsRoutineModalOpen(false);
          setIsTimeSettingsModalOpen(false);
          setIsSettingsModalOpen(true);
        }}
        onOpenTimeSettings={() => {
          setIsProfileMenuOpen(false);
          setIsRoutineModalOpen(false);
          setIsSettingsModalOpen(false);
          setIsTimeSettingsModalOpen(true);
        }}
      />

      <div
        className={styles.appContent}
        ref={containerRef}
        onClick={handleBackgroundClick}
      >
        <CalendarList
          weeksData={renderedWeeksData}
          eventsByWeek={eventsByWeek}
          todosByWeek={todosByWeek}
          routines={routines}
          routineCompletions={routineCompletions}

          weekOrder={weekOrder}
          diaryCompletionMap={Object.keys(diaryEntries).reduce((acc, date) => ({ ...acc, [date]: true }), {})}
          showRoutines={showRoutines}
          showDiary={showDiary}
          showEmotion={showEmotion}
          showTodos={showTodos}
          onDateClick={handleDateClick}
          onEventDoubleClick={handleEventDoubleClick}
          onDeleteEvent={handleDeleteEventWrapper} // Pass wrapper for list-view deletion
          onOpenDiary={handleOpenDiary}
          onOpenEmotion={handleOpenEmotion}
          topSentinelRef={topSentinelRef as React.RefObject<HTMLDivElement>}
          bottomSentinelRef={bottomSentinelRef as React.RefObject<HTMLDivElement>}
        />
      </div>

      <Suspense fallback={null}>
        <AppModals
          popupPosition={popupPosition}
          selectedDate={selectedDate}
          isEventModalOpen={isEventModalOpen}
          selectedEvent={selectedEvent}
          draftEvent={draftEvent as Event}
          modalSessionId={modalSessionId}
          routines={routines}
          calendars={[...calendarMetadata, ...googleCalendars].filter(c => !c.isSubscription && !c.readOnly)}
          allCalendars={[...calendarMetadata, ...googleCalendars]}
          isRoutineModalOpen={isRoutineModalOpen}
          isCalDAVModalOpen={isCalDAVModalOpen}
          isGoogleSyncModalOpen={isGoogleSyncModalOpen}
          isSettingsModalOpen={isSettingsModalOpen}
          avatarUrl={avatarUrl}
          weekOrder={weekOrder}
          onCloseEventModal={() => { setIsEventModalOpen(false); setDraftEvent(null); }}
          onAddEvent={handleAddEventWrapper}
          onUpdateEvent={handleUpdateEventWrapper}
          onDeleteEvent={handleDeleteEventWrapper}
          onDraftUpdate={handleDraftUpdateWrapper}
          onCloseRoutineModal={() => setIsRoutineModalOpen(false)}
          onAddRoutine={addRoutine}
          onDeleteRoutine={deleteRoutine}
          onUpdateRoutine={updateRoutine}
          onCloseCalDAVModal={() => setIsCalDAVModalOpen(false)}
          calDAVMode={calDAVModalMode}
          onSyncComplete={async (count, syncedCalendarUrls) => {
            console.log(`Sync complete: ${count} items. Refreshing...`);
            loadData(true);
            if (syncedCalendarUrls && syncedCalendarUrls.length > 0) {
              const urlRemap = refreshMetadataWithServerList(syncedCalendarUrls); // string[] 호환
              // 이벤트 re-link: Mac Calendar에서 삭제된 캘린더의 이벤트를 로컬 URL로 업데이트
              if (urlRemap.size > 0) {
                for (const [oldUrl, newLocalUrl] of urlRemap.entries()) {
                  const { error } = await supabase
                    .from('events')
                    .update({ calendar_url: newLocalUrl })
                    .eq('calendar_url', oldUrl);
                  if (error) console.error(`[Sync] Event re-link failed: ${oldUrl} →`, error);
                  else console.log(`[Sync] Re-linked events: ${oldUrl} → ${newLocalUrl}`);
                }
                loadData(true); // re-link 후 다시 로드
              }
            } else {
              refreshMetadata();
            }
            setToast({ message: '캘린더 동기화에 성공했습니다.', type: 'success' });
            if (pendingSyncCalendar) {
              const cal = pendingSyncCalendar;
              setPendingSyncCalendar(null);
              setTimeout(() => handleSyncToMac(cal), 500);
            }
          }}
          onCloseGoogleSyncModal={() => setIsGoogleSyncModalOpen(false)}
          onGoogleSyncComplete={async (selectedMeta) => {
            setIsGoogleSyncModalOpen(false);
            await syncGoogleCalendar(selectedMeta);
            setToast({ message: 'Google 캘린더 동기화에 성공했습니다.', type: 'success' });
          }}
          onGoogleDisconnect={async () => {
            const { deleteAllGoogleData } = await import('../services/api');
            const ok = await deleteAllGoogleData();
            if (ok) {
              // Clear local google state
              localStorage.removeItem('googleCalendarsMeta');
              localStorage.removeItem('googleSelectedCalendarIds');
              localStorage.removeItem('googleSyncTokens');
              setIsGoogleSyncModalOpen(false);
              loadData(true);
              setToast({ message: 'Google 연동이 해제되었습니다.', type: 'success' });
            } else {
              setToast({ message: 'Google 연동 해제 중 오류가 발생했습니다.', type: 'error' });
            }
          }}
          googleCalendars={googleCalendars}
          onCloseSettings={() => setIsSettingsModalOpen(false)}
          onSettingsSaved={({ avatarUrl: u, weekOrder: w }) => { setAvatarUrl(u); setWeekOrder(w); }}
        />

        {isTimeSettingsModalOpen && (
          <TimeSettingsModal
            onClose={() => setIsTimeSettingsModalOpen(false)}
            initialWeekOrder={weekOrder}
            initialTimezone={appTimezone}
            initialAutoTimezone={autoTimezone}
            onSaved={({ weekOrder: w, timezone: tz, autoTimezone: auto }) => {
              setWeekOrder(w);
              localStorage.setItem('weekOrder', w);
              setAppTimezone(tz);
              localStorage.setItem('appTimezone', tz);
              setAutoTimezone(auto);
              localStorage.setItem('autoTimezone', String(auto));
            }}
          />
        )}

        {isDiaryModalOpen && activeDiaryDate && (
          <DiaryModal
            date={activeDiaryDate}
            events={activeDiaryEvents}
            currentEmotion={emotions[activeDiaryDate]}

            weekOrder={weekOrder}
            initialEntry={activeDiaryEntry}
            onClose={() => { setIsDiaryModalOpen(false); setActiveDiaryDate(null); }}
            onSaved={handleDiarySavedWrapper}
            onSave={upsertDiaryEntry} // Direct API call for modal to use
            onDelete={handleDiaryDeleteWrapper}
          />
        )}

        {isSubscribeModalOpen && (
          <SubscribeModal
            onClose={() => setIsSubscribeModalOpen(false)}
            onSubscribeSuccess={(message) => {
              setToast({ message, type: 'success' });
              loadData(true);
            }}
            calendarMetadata={calendarMetadata}
            setCalendarMetadata={setCalendarMetadata}
          />
        )}
      </Suspense>

      {/* Global Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={() => {
          if (confirmDialog.onConfirm) confirmDialog.onConfirm();
          setConfirmDialog({ isOpen: false, message: '' });
        }}
      />

      {/* Calendar Delete Dialog */}
      <ConfirmDialog
        isOpen={calDeleteState?.isOpen === true}
        title={calDeleteState?.isUnsync ? "동기화 해제" : "캘린더 삭제"}
        message={
          calDeleteState?.isUnsync
            ? "동기화를 끊습니다. 하지만 iCloud의 기존 일정은 그대로 남아 있습니다."
            : (calDeleteState?.isCalDAV ? undefined : `'${calDeleteState?.name}'를 삭제하시겠습니까?`)
        }
        confirmText="확인"
        cancelText="취소"
        onConfirm={handleConfirmDelete}
        onCancel={() => setCalDeleteState(null)}
        onClose={() => setCalDeleteState(null)}
      >
        {calDeleteState?.isCalDAV && !calDeleteState?.isUnsync && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px', marginBottom: '8px' }}>
            <p style={{ margin: 0, fontSize: '0.95rem', color: '#111827', fontWeight: 500, whiteSpace: 'pre-wrap' }}>
              '{calDeleteState.name}'를 삭제하시겠습니까?
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.95rem', color: '#374151' }}>
              <input
                type="radio"
                name="calDeleteOption"
                checked={calDeleteOption === 'local'}
                onChange={() => setCalDeleteOption('local')}
                style={{ width: '16px', height: '16px', accentColor: '#3b82f6' }}
              />
              Riff에서만 삭제
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.95rem', color: '#374151' }}>
              <input
                type="radio"
                name="calDeleteOption"
                checked={calDeleteOption === 'remote'}
                onChange={() => setCalDeleteOption('remote')}
                style={{ width: '16px', height: '16px', accentColor: '#ff3b30' }}
              />
              iCloud까지 모두 삭제
            </label>
          </div>
        )}
      </ConfirmDialog>

      {/* Toast Notification (Portal) */}
      {toast && createPortal(
        <div style={{
          position: 'fixed', bottom: '32px', right: '32px',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          padding: '14px 24px', borderRadius: '16px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)',
          fontSize: '0.95rem', fontWeight: 600, color: '#1f2937',
          display: 'flex', alignItems: 'center', gap: '12px',
          zIndex: 999999, // Ensure highest priority
          animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          pointerEvents: 'none' // Click through
        }}>
          {toast.type === 'loading' && (
            <div className={styles.spinner} style={{ width: 18, height: 18, border: '2.5px solid #e5e7eb', borderTopColor: '#10b981', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          )}
          {toast.type === 'success' && <div style={{ color: '#10b981', display: 'flex' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>}
          {toast.message}
          <style>{`
             @keyframes slideUp { from { transform: translateY(30px) scale(0.9); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
             @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
           `}</style>
        </div>,
        document.body
      )}
      {/* --- Emotion Modal --- */}
      {isEmotionModalOpen && emotionModalDate && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10000 }}>
          <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'auto' }}>
            <EmotionModal
              date={emotionModalDate}
              position={emotionModalPosition}
              currentEmotion={emotions?.[emotionModalDate]}
              onSelect={(emoji) => {
                setEmotion(emotionModalDate, emoji);
              }}
              onClose={() => setIsEmotionModalOpen(false)}
            />
          </div>
        </div>
      )}

    </div>
  );
};