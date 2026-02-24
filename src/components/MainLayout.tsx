import { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useWindowedSync, SyncRange } from '../hooks/useWindowedSync';
import { AppHeader } from './AppHeader';
import { CalendarList } from './CalendarList';
import { CalendarListPopup, CalendarToggleButton } from './CalendarListPopup';
import { useData } from '../contexts/DataContext';
import { useSelection, useHover } from '../contexts/SelectionContext';
import { useCalendarMetadata } from '../hooks/useCalendarMetadata';
import { WeekOrder, Event, DiaryEntry, Todo } from '../types';
import { normalizeCalendarUrl, CalendarMetadata, upsertDiaryEntry, getUserAvatar, getCalDAVSyncSettings } from '../services/api';
import { createCalDavEvent, updateCalDavEvent, deleteCalDavEvent, syncSelectedCalendars, CalDAVConfig, createRemoteCalendar, deleteRemoteCalendar, getCalendars } from '../services/caldav';
import { getWeekStartForDate, getTodoWeekStart, formatLocalDate } from '../utils/dateUtils';
import { HistoryAction } from '../hooks/useUndoRedo';
import { ModalPosition } from './EventModal';
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
    events, routines, routineCompletions, todos, diaryEntries,
    addEvent, updateEvent, deleteEvent,
    addRoutine, deleteRoutine, updateRoutine,
    fetchDiary, saveDiary, deleteDiary,
    loadData // Add loadData for auto-sync refresh
  } = useData();

  const {
    selectedEventIds, clearSelection,
    clipboardEvent, setClipboardEvent
  } = useSelection();
  const { hoveredDate } = useHover();
  const {
    calendarMetadata,
    setCalendarMetadata,
    visibleCalendarUrlSet,
    setVisibleCalendarUrlSet,
    toggleCalendarVisibility,
    addLocalCalendar,
    updateLocalCalendar,
    convertLocalToCalDAV,
    deleteCalendar,
    refreshMetadata,
    refreshMetadataWithServerList
  } = useCalendarMetadata();

  const { recordAction, registerCategoryHandlers } = useData();

  const [isSyncEnabled, setIsSyncEnabled] = useState(false);
  // 앱 초기 로드 시 1회: 유령 캘린더 정리를 위한 메타데이터 검증
  const hasMetadataCheckedRef = useRef(false);

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

  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSubscribeModalOpen, setIsSubscribeModalOpen] = useState(false);
  const [isCalDAVModalOpen, setIsCalDAVModalOpen] = useState(false);
  const [calDAVModalMode, setCalDAVModalMode] = useState<'sync' | 'auth-only'>('sync');
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

  const [showRoutines, setShowRoutines] = useState(true);
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
    step: 'confirm' | 'server-confirm';
    url: string;
    name: string;
    isCalDAV: boolean;
  } | null>(null);

  // Toast State
  const [toast, setToast] = useState<{ message: string; type: 'loading' | 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (toast && toast.type !== 'loading') {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

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
        const serverUrls = serverCalendars.map(c => c.url);
        // 여기서 유령 캘린더 정리됨
        refreshMetadataWithServerList(serverUrls);
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
    supabase.auth.signOut();
  }, []);

  // Note: Initial load is now handled by useCalendarMetadata hook




  // --- Data Processing (Weeks, Events By Week) ---
  // --- Data Processing (Weeks, Events By Week) ---
  const filteredEvents = useMemo(() => {
    const list = events.filter(e => {
      if (selectedEvent && e.id === selectedEvent.id) return true;

      // Handle local events (no calendarUrl)
      if (!e.calendarUrl) return true;

      // Check visibility
      return visibleCalendarUrlSet.has(normalizeCalendarUrl(e.calendarUrl!) || '');
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
  }, [events, visibleCalendarUrlSet, selectedEvent, draftEvent, calendarMetadata]);


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
  const handleDateClick = useCallback((date: string, anchorEl?: HTMLElement, timeSlot?: 'am' | 'pm') => {
    // Toggle check: If clicking the same date while modal is open, close it.
    if (selectedDate === date && isEventModalOpen) {
      setIsEventModalOpen(false);
      setPopupPosition(null);
      setSelectedDate(null);
      return;
    }

    // Default times based on slot
    const defaultStart = timeSlot === 'pm' ? '13:00' : '09:00';
    const defaultEnd = timeSlot === 'pm' ? '14:00' : '10:00';

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
      setDraftEvent(prev => (prev && prev.date === newEvent.date ? null : prev));

      // 3. Perform CalDAV Sync in background
      (async () => {
        try {
          if (event.calendarUrl) {
            const calMeta = calendarMetadata.find(c => normalizeCalendarUrl(c.url) === normalizeCalendarUrl(event.calendarUrl));
            const isCalDavCalendar = calMeta?.type === 'caldav'
              || (event.calendarUrl && (event.calendarUrl.includes('caldav') || event.calendarUrl.includes('icloud')));

            if (isCalDavCalendar) {
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
          console.error('CalDAV Sync Error (Background):', e);
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
  }, [addEvent, calendarMetadata, setVisibleCalendarUrlSet, recordAction]);

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

        const isCalDavCalendar = calMeta?.type === 'caldav'
          || (calendarUrl && (calendarUrl.includes('caldav') || calendarUrl.includes('icloud')));

        if (isCalDavCalendar) {
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
                // Ensure calendarUrl is treated as string since we checked it in the if condition above
                const { success: caldavSuccess } = await deleteCalDavEvent(config, eventToDelete.calendarUrl!, eventToDelete.caldavUid!);

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
          // targetCalendarUrl is confirmed truthy by enclosing block
          const calMeta = calendarMetadata.find(c => normalizeCalendarUrl(c.url) === normalizeCalendarUrl(targetCalendarUrl));
          const isCalDavCalendar = calMeta?.type === 'caldav'
            || (targetCalendarUrl && (targetCalendarUrl.includes('caldav') || targetCalendarUrl.includes('icloud')));

          const uid = updates.caldavUid || oldEvent.caldavUid;

          if (isCalDavCalendar && uid) {
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

                // Check if Calendar Changed (Move Operation)
                const isMovingCalendar = updates.calendarUrl &&
                  normalizeCalendarUrl(updates.calendarUrl) !== normalizeCalendarUrl(oldEvent.calendarUrl || '');

                const mergedEvent = { ...oldEvent, ...updates };

                if (isMovingCalendar && oldEvent.calendarUrl) {
                  // MOVE: Delete from Old -> Create in New
                  // Check if Old Calendar is Read-Only too?
                  // Ideally yes, but we might want to just Create in New even if Delete fails.
                  // But for now, let's proceed.
                  console.log(`Moving event ${uid} from ${oldEvent.calendarUrl} to ${targetCalendarUrl}`);

                  // 1. Delete from Old
                  const { success: deleteSuccess } = await deleteCalDavEvent(config, oldEvent.calendarUrl, uid);
                  if (!deleteSuccess) {
                    console.error('CalDAV Move: Failed to delete from old calendar', oldEvent.calendarUrl);
                  }

                  // 2. Create in New
                  const { success: createSuccess } = await createCalDavEvent(config, targetCalendarUrl, mergedEvent);
                  if (!createSuccess) {
                    console.error('CalDAV Move: Failed to create in new calendar', targetCalendarUrl);
                  }

                } else {
                  // UPDATE: Same Calendar
                  console.log(`Updating event ${uid} in ${targetCalendarUrl}`);
                  const { success } = await updateCalDavEvent(config, targetCalendarUrl, uid, mergedEvent);
                  if (!success) {
                    console.error('CalDAV update failed');
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error('CalDAV Background Update Error:', e);
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

  const activeDiaryEntry = activeDiaryDate ? diaryEntries[activeDiaryDate] : undefined;

  const activeDiaryEvents = useMemo(() => {
    if (!activeDiaryDate) return [];
    return events.filter(e => e.date === activeDiaryDate);
  }, [events, activeDiaryDate]);

  const handleBackgroundClick = useCallback(() => {
    // If event bubbled up here, it means it wasn't handled by specific elements (like EventItem)
    // so we clear selection.
    if (selectedEventIds.length > 0) {
      clearSelection();
    }
    // Note: We don't clear selectedEvent (modal state) here instantly because
    // usually clicking background doesn't close modal unless it's the modal backdrop.
    // But user request was "deselect" which usually refers to the highlighted selection.
  }, [selectedEventIds, clearSelection]);

  const handleDeleteCalendar = useCallback((url: string) => {
    const calendar = calendarMetadata.find(c => c.url === url);
    if (!calendar) return;

    setCalDeleteState({
      isOpen: true,
      step: 'confirm', // Start with basic confirmation
      url,
      name: calendar.displayName || '캘린더',
      isCalDAV: !calendar.isLocal && !calendar.readOnly && !calendar.isSubscription && calendar.type !== 'subscription',
    });
  }, [calendarMetadata]);

  const handleConfirmDeleteStep1 = useCallback(() => {
    if (!calDeleteState) return;

    if (calDeleteState.isCalDAV) {
      // Proceed to server delete confirmation
      setCalDeleteState(prev => prev ? { ...prev, step: 'server-confirm' } : null);
    } else {
      // Just local/sub delete
      executeDeleteCalendar(calDeleteState.url, false);
      setCalDeleteState(null);
    }
  }, [calDeleteState]);

  const handleConfirmDeleteStep2 = useCallback(async () => {
    if (!calDeleteState) return;
    const { url } = calDeleteState;
    // 1. Close dialog immediately (Optimistic UI)
    setCalDeleteState(null);

    // 2. Process in background
    // Delete from server AND local
    await executeDeleteCalendar(url, true);
  }, [calDeleteState]);

  const handleCancelDeleteStep2 = useCallback(async () => {
    if (!calDeleteState) return;
    const { url } = calDeleteState;
    // 1. Close dialog immediately
    setCalDeleteState(null);

    // 2. Process in background
    // Just delete local (unsubscribe)
    await executeDeleteCalendar(url, false);
  }, [calDeleteState]);

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

          setVisibleCalendarUrlSet(prev => {
            const next = new Set(prev);
            next.delete(calendar.url);
            next.add(result.calendarUrl);
            return next;
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
  }, [getCalDAVSyncSettings, convertLocalToCalDAV, setVisibleCalendarUrlSet]);

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

      <>
        {!isCalendarPopupOpen && <CalendarToggleButton onClick={() => setIsCalendarPopupOpen(true)} />}
        {isCalendarPopupOpen && (
          <CalendarListPopup
            calendars={calendarMetadata}
            visibleUrlSet={visibleCalendarUrlSet}
            onToggle={toggleCalendarVisibility}
            onClose={() => setIsCalendarPopupOpen(false)}
            onAddLocalCalendar={addLocalCalendar}
            onUpdateLocalCalendar={updateLocalCalendar}
            onDeleteCalendar={handleDeleteCalendar}
            onSyncToMac={handleSyncToMac}
            onOpenCalDAVModal={() => {
              setCalDAVModalMode('sync');
              setIsCalDAVModalOpen(true);
            }}
            onOpenSubscribeModal={() => {
              setIsSubscribeModalOpen(true);
            }}
            onShowToast={(message, type) => setToast({ message, type })}
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

        onOpenRoutine={() => {
          setIsProfileMenuOpen(false);
          setIsSettingsModalOpen(false);
          setIsTimeSettingsModalOpen(false);
          setIsRoutineModalOpen(true);
        }}
        showRoutines={showRoutines}
        onToggleRoutines={() => setShowRoutines(p => !p)}
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
          showTodos={showTodos}
          onDateClick={handleDateClick}
          onEventDoubleClick={handleEventDoubleClick}
          onDeleteEvent={handleDeleteEventWrapper} // Pass wrapper for list-view deletion
          onOpenDiary={handleOpenDiary}
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
          calendars={calendarMetadata.filter(c => !c.isSubscription && !c.readOnly)}
          isRoutineModalOpen={isRoutineModalOpen}
          isCalDAVModalOpen={isCalDAVModalOpen}
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
          onSyncComplete={(count, syncedCalendarUrls) => {
            console.log(`Sync complete: ${count} items. Refreshing...`);
            loadData(true); // Refresh events

            // 서버 캘린더 목록과 비교하여 createdFromApp 플래그 정리
            if (syncedCalendarUrls && syncedCalendarUrls.length > 0) {
              refreshMetadataWithServerList(syncedCalendarUrls);
            } else {
              refreshMetadata(); // Fallback to simple refresh
            }

            setToast({ message: '캘린더 동기화에 성공했습니다.', type: 'success' });

            if (pendingSyncCalendar) {
              const cal = pendingSyncCalendar;
              setPendingSyncCalendar(null);
              // 설정 저장 후 모달이 닫히고 나서 실행되도록 약간 지연
              setTimeout(() => handleSyncToMac(cal), 500);
            }
          }}
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
            setVisibleCalendarUrlSet={setVisibleCalendarUrlSet}
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

      {/* Calendar Delete Dialog - Step 1: Basic Delete Confirm */}
      <ConfirmDialog
        isOpen={calDeleteState?.isOpen === true && calDeleteState?.step === 'confirm'}
        title="캘린더 삭제"
        message={`'${calDeleteState?.name}'를 삭제하시겠습니까?`}
        confirmText="확인"
        cancelText="취소"
        onConfirm={handleConfirmDeleteStep1}
        onCancel={() => setCalDeleteState(null)}
        onClose={() => setCalDeleteState(null)}
      />

      {/* Calendar Delete Dialog - Step 2: Server Delete Confirm */}
      <ConfirmDialog
        isOpen={calDeleteState?.isOpen === true && calDeleteState?.step === 'server-confirm'}
        title="서버 원본 삭제 확인"
        message={'맥(iCloud) 캘린더 서버에서도 이 캘린더를 영구적으로 삭제하시겠습니까?\n\n[확인]을 누르면 원본이 삭제됩니다.\n[취소]를 누르면 이 앱의 목록에서만 제거됩니다.'}
        confirmText="확인"
        cancelText="취소"
        onConfirm={handleConfirmDeleteStep2}
        onCancel={handleCancelDeleteStep2}
        onClose={() => setCalDeleteState(null)}
      />

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
    </div>
  );
};