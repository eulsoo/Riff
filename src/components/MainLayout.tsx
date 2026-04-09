import { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useWindowedSync, SyncRange } from '../hooks/useWindowedSync';
import { useSyncHandlers } from '../hooks/useSyncHandlers';
import { AppHeader } from './AppHeader';
import { CalendarList } from './CalendarList';
import { CalendarListPopup } from './CalendarListPopup';
import { useData } from '../contexts/DataContext';
import { useSelection, useHover } from '../contexts/SelectionContext';
import { useDrag } from '../contexts/DragContext';
import { useCalendarMetadata } from '../hooks/useCalendarMetadata';
import { WeekOrder, Event, DiaryEntry, Todo } from '../types';
import { normalizeCalendarUrl, CalendarMetadata, upsertDiaryEntry, getUserAvatar, getCalDAVSyncSettings, deleteEventsByCalendarUrl } from '../services/api';
import { syncSelectedCalendars, CalDAVConfig } from '../services/caldav';
import { buildCalDAVConfigFromSettings, getCalDAVSyncTargets, isCalDAVAuthErrorMessage, isCalDAVSyncTarget, isSubscriptionLikeCalendar, isWritableCalendar, runCalDAVServerCheck } from '../services/calendarSyncUtils';
import { relinkEventsByCalendarUrl } from '../services/calendarEventRelink';
import { syncRemoteEventCreateInBackground, syncRemoteEventDeleteInBackground, syncRemoteEventUpdateInBackground } from '../services/remoteEventSync';
import { runCalendarDeleteFlow, runCalendarUnsyncFlow } from '../services/calendarDeleteFlow';
import { handleGoogleExternalDelete } from '../services/calendarExternalDeleteFlow';
import { deleteGoogleCalendarById } from '../services/calendarGoogleSyncFlow';
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
    syncGoogleCalendar, isSyncingGoogle, isGoogleTokenExpired, hasGoogleProvider, clearGoogleTokenExpiredFlag, googleCalendars, removeGoogleCalendar,
    externallyDeletedCalendars, clearExternallyDeletedCalendars,
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
    convertLocalToGoogle,
    convertCalDAVToLocal,
    convertGoogleToLocal,
    deleteCalendar,
    refreshMetadata,
    refreshMetadataWithServerList
  } = useCalendarMetadata();

  const { recordAction, registerCategoryHandlers } = useData();

  const [isSyncEnabled, setIsSyncEnabled] = useState(false);
  // 앱 초기 로드 시 1회: 유령 캘린더 정리를 위한 메타데이터 검증
  const hasMetadataCheckedRef = useRef(false);
  // 동기화 해제 직후 진행 중인 sync가 해당 캘린더를 재추가하지 않도록
  const unsyncedUrlsRef = useRef<Set<string>>(new Set());

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
    if (!settings || !settings.enabled) {
      if (isManual) console.log('Sync skipped: No settings found');
      return;
    }

    if (calendarMetadata.length === 0) {
      if (isManual) console.log('Sync skipped: No calendar metadata');
      return;
    }

    // 2. Filter Calendars — selectedCalendarUrls에 있는 것만 동기화
    // (사용자가 명시적으로 선택한 캘린더만, 이전에 동기화했다가 해제된 캘린더 제외)
    const caldavCalendars = getCalDAVSyncTargets(calendarMetadata, settings.selectedCalendarUrls);
    if (caldavCalendars.length === 0) return;

    if (isManual) {
      console.log('Starting windowed sync for:', caldavCalendars.map(c => c.displayName).join(', '));
    }

    // 3. Prepare Config
    const config: CalDAVConfig = buildCalDAVConfigFromSettings(settings);
    const caldavUrls = caldavCalendars.map(c => c.url);

    try {
      // 4. Execute Sync (Range provided by hook!)
      const forceFullSync = false;
      const count = await syncSelectedCalendars(
        config,
        caldavUrls,
        {
          forceFullSync,
          manualRange: range,
          excludeCalendarUrls: unsyncedUrlsRef.current
        }
      );

      if (count !== 0 || isManual) {
        if (isManual) console.log(`Sync complete. Reloading data...`);
        loadData(true);
      }
      unsyncedUrlsRef.current.clear(); // 동기화 해제 exclude 목록 초기화
      localStorage.removeItem('caldavAuthError');
      setIsCalDAVAuthError(false);

      // 5. 서버 캘린더 목록 확인 로직은 매번 Sync마다 수행하면 오버헤드 및 무한 리렌더링 위험이 있으므로,
      // 별도의 주기적 확인이나 초기화 단계로 이동하는 것이 좋음. 현재는 제거.
      // const hasCalDAVCalendars = ...
    } catch (error: any) {
      if (error?.message === 'Network is offline' || error?.code === 'OFFLINE') {
        console.log('Sync skipped (Offline)');
      } else {
        console.warn('Sync failed:', error);
        const msg = String(error?.message || error || '');
        if (isCalDAVAuthErrorMessage(msg)) {
          localStorage.setItem('caldavAuthError', 'true');
          setIsCalDAVAuthError(true);
        }
      }
    }
  }, [calendarMetadata, loadData, refreshMetadataWithServerList]);

  // Use the reusable hook for Infinite Scroll & Windowed Fetching
  const { trigger: triggerCalDAVSync } = useWindowedSync({
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
    if (!hasCreatedFromApp) return;

    lastCalendarCheckRef.current = now;

    runCalDAVServerCheck('[PopupCheck]', {
      refreshMetadataWithServerList,
      loadData,
      onClearAuthError: () => {
        localStorage.removeItem('caldavAuthError');
        setIsCalDAVAuthError(false);
      },
      onRestoredCalendar: (name) =>
        setToast({ message: `iCloud 캘린더(${name})가 삭제되어 Riff 로컬 캘린더로 전환됐습니다.`, type: 'info' }),
      onDeletedCalendar: (name) =>
        setToast({ message: `iCloud에서 삭제된 캘린더(${name})를 Riff에서도 제거했습니다.`, type: 'info' }),
    }).catch((e: any) => {
      console.warn('[PopupCheck] Server calendar check failed:', e);
      const msg = String(e?.message || e || '');
      if (isCalDAVAuthErrorMessage(msg)) {
        localStorage.setItem('caldavAuthError', 'true');
        setIsCalDAVAuthError(true);
      }
    });
  }, [isCalendarPopupOpen, calendarMetadata, refreshMetadataWithServerList, loadData]);

  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSubscribeModalOpen, setIsSubscribeModalOpen] = useState(false);
  const [isCalDAVModalOpen, setIsCalDAVModalOpen] = useState(false);
  const [calDAVModalMode, setCalDAVModalMode] = useState<'sync' | 'auth-only'>('sync');
  const [calDAVAuthNoticeMessage, setCalDAVAuthNoticeMessage] = useState<string | undefined>(undefined);
  const [isGoogleSyncModalOpen, setIsGoogleSyncModalOpen] = useState(false);
  const [googleSyncModalMode, setGoogleSyncModalMode] = useState<'sync' | 'auth-only'>('sync');
  const [googleAuthNoticeMessage, setGoogleAuthNoticeMessage] = useState<string | undefined>(undefined);
  const [pendingSyncCalendar, setPendingSyncCalendar] = useState<CalendarMetadata | null>(null);
  const googleLocalSyncInFlightRef = useRef<Set<string>>(new Set());
  const googlePendingRecoveryInFlightRef = useRef(false);
  const calendarMetadataRef = useRef(calendarMetadata);
  useEffect(() => {
    calendarMetadataRef.current = calendarMetadata;
  }, [calendarMetadata]);
  // 메모리 릭 방지: onSyncComplete 내 setTimeout cleanup용 ref
  const pendingSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pendingSyncTimerRef.current) clearTimeout(pendingSyncTimerRef.current);
  }, []);
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
  const [isCalDAVAuthError, setIsCalDAVAuthError] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('caldavAuthError') === 'true'
  );
  const [isCalDAVCredentialsSaved, setIsCalDAVCredentialsSaved] = useState(false);
  useEffect(() => {
    getCalDAVSyncSettings().then(r => setIsCalDAVCredentialsSaved(!!r?.password));
  }, []);
  const [calDeleteState, setCalDeleteState] = useState<{
    isOpen: boolean;
    url: string;
    name: string;
    isCalDAV: boolean;
    isUnsync?: boolean;
    isGoogle?: boolean;
    isCreatedFromApp?: boolean;
  } | null>(null);
  const [calDeleteOption, setCalDeleteOption] = useState<'local' | 'remote'>('local');

  // Server Delete Failed Dialog
  const [serverDeleteFailedDialog, setServerDeleteFailedDialog] = useState<{
    isOpen: boolean;
    calName: string;
    localDelete?: () => Promise<void>;
  }>({ isOpen: false, calName: '' });

  // Post-Auth Sync Suggestion Dialog
  const [isPostAuthSyncDialogOpen, setIsPostAuthSyncDialogOpen] = useState(false);
  const [postAuthSyncService, setPostAuthSyncService] = useState<'caldav' | 'google'>('caldav');

  // Toast State
  const [toast, setToast] = useState<{ message: string; type: 'loading' | 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    if (toast && toast.type !== 'loading') {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // ── 동기화 핸들러 훅 ──────────────────────────────────────────────────────
  const {
    handleUpdateLocalCalendar,
    handleSyncToMac,
    handleSyncToGoogle,
    handleDualSyncToGoogle,
    handleDualSyncToCalDAV,
    handleDeleteCalendar,
    handleSyncSwitchToggle,
  } = useSyncHandlers({
    calendarMetadata,
    googleCalendars,
    calendarMetadataRef,
    convertLocalToCalDAV,
    convertLocalToGoogle,
    updateLocalCalendar,
    clearGoogleTokenExpiredFlag,
    googleLocalSyncInFlightRef,
    googlePendingRecoveryInFlightRef,
    setCalDeleteState,
    setCalDeleteOption,
    setToast,
    setConfirmDialog,
    setHiddenCalendarUrls,
    setPendingSyncCalendar,
    setIsCalDAVModalOpen,
    setCalDAVModalMode,
    setCalDAVAuthNoticeMessage,
    setIsGoogleSyncModalOpen,
    setGoogleSyncModalMode,
    setGoogleAuthNoticeMessage,
  });

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

  // Google linkIdentity 리다이렉트 복귀 감지: sessionStorage 플래그 확인
  useEffect(() => {
    if (sessionStorage.getItem('googleLinkPending') === '1') {
      // googleTokenExpired 플래그를 미리 해제해 아이콘이 즉시 정상화되도록 함
      clearGoogleTokenExpiredFlag();
      // 플래그는 GoogleSyncModal 내부에서 제거함 (모달 init에서 처리)
      setGoogleSyncModalMode('sync');
      setGoogleAuthNoticeMessage(undefined);
      setIsGoogleSyncModalOpen(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (calendarMetadata.length === 0) return;

    if (hasMetadataCheckedRef.current) {
      if (!isSyncEnabled) setIsSyncEnabled(true);
      return;
    }

    const hasCalDAV = calendarMetadata.some(c => isCalDAVSyncTarget(c));
    if (!hasCalDAV) {
      setIsSyncEnabled(true);
      hasMetadataCheckedRef.current = true;
      return;
    }

    hasMetadataCheckedRef.current = true;
    runCalDAVServerCheck('[Metadata]', {
      refreshMetadataWithServerList,
      loadData,
      onClearAuthError: () => {
        localStorage.removeItem('caldavAuthError');
        setIsCalDAVAuthError(false);
      },
      onRestoredCalendar: (name) =>
        setToast({ message: `iCloud 캘린더(${name})가 삭제되어 Riff 로컬 캘린더로 전환됐습니다.`, type: 'info' }),
      onDeletedCalendar: (name) =>
        setToast({ message: `iCloud에서 삭제된 캘린더(${name})를 Riff에서도 제거했습니다.`, type: 'info' }),
    })
      .catch(e => console.warn('[MainLayout] Metadata validation failed:', e))
      .finally(() => setIsSyncEnabled(true));
  }, [calendarMetadata, refreshMetadataWithServerList, loadData, isSyncEnabled]);



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

  const closeHeaderPanels = useCallback(() => {
    setIsProfileMenuOpen(false);
    setIsRoutineModalOpen(false);
    setIsSettingsModalOpen(false);
    setIsTimeSettingsModalOpen(false);
  }, []);

  const handleToggleProfileMenu = useCallback(() => {
    setIsProfileMenuOpen(prev => !prev);
  }, []);

  const handleOpenRoutineFromHeader = useCallback(() => {
    closeHeaderPanels();
    setIsRoutineModalOpen(true);
  }, [closeHeaderPanels]);

  const handleOpenSettingsFromHeader = useCallback(() => {
    closeHeaderPanels();
    setIsSettingsModalOpen(true);
  }, [closeHeaderPanels]);

  const handleOpenTimeSettingsFromHeader = useCallback(() => {
    closeHeaderPanels();
    setIsTimeSettingsModalOpen(true);
  }, [closeHeaderPanels]);

  const handleToggleRoutines = useCallback(() => {
    setShowRoutines(prev => !prev);
  }, []);

  const handleToggleDiary = useCallback(() => {
    setShowDiary(prev => !prev);
  }, []);

  const handleToggleEmotion = useCallback(() => {
    setShowEmotion(prev => !prev);
  }, []);

  const handleToggleTodos = useCallback(() => {
    setShowTodos(prev => !prev);
  }, []);

  const handleSubscribeSuccess = useCallback((message: string) => {
    setToast({ message, type: 'success' });
    loadData(true);
  }, [loadData]);

  // Note: Initial load is now handled by useCalendarMetadata hook




  // --- Data Processing (Weeks, Events By Week) ---
  const filteredEvents = useMemo(() => {
    // O(1) URL 룩업을 위한 Map 사전 빌드 (이벤트마다 find() 반복 O(n²) 제거)
    const calMetaByNormUrl = new Map(
      calendarMetadata.map(c => [normalizeCalendarUrl(c.url) || c.url, c])
    );
    const knownUrls = new Set(calMetaByNormUrl.keys());

    const list = events.filter(e => {
      if (selectedEvent && e.id === selectedEvent.id) return true;

      if (!e.calendarUrl) return true;

      const normalizedUrl = normalizeCalendarUrl(e.calendarUrl!) || '';

      // 동기화 해제된 캘린더: 즉시 표시에서 제외 (loadData 병합 전에도 적용)
      if (unsyncedUrlsRef.current.has(normalizedUrl) || unsyncedUrlsRef.current.has(e.calendarUrl!)) {
        return false;
      }

      // 등록된 캘린더: 가시성 설정에 따라 필터링
      if (knownUrls.has(normalizedUrl)) {
        return visibleCalendarUrlSet.has(normalizedUrl);
      }

      // 미등록 캘린더 (DB 메타데이터 아직 로딩 중이거나 Google 캘린더 등):
      // 명시적으로 숨긴 경우만 제외, 나머지는 기본 표시
      return !hiddenCalendarUrls.has(normalizedUrl);
    }).map(e => {
      // 캘린더 메타데이터의 색상을 이벤트에 실시간 반영 (Map O(1) 룩업)
      if (e.calendarUrl) {
        const cal = calMetaByNormUrl.get(normalizeCalendarUrl(e.calendarUrl) || e.calendarUrl);
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

      void syncRemoteEventCreateInBackground({
        inputEvent: eventToSave,
        savedEvent: newEvent,
        calendarMetadata,
        onGoogleUidMapped: async (gId: string) => {
          await updateEvent(newEvent.id, { caldavUid: gId });
        },
      });
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
      if (isSubscriptionLikeCalendar(calMeta)) {
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

    // 2. Background Sync
    if (eventToDelete?.calendarUrl && eventToDelete.caldavUid) {
      void syncRemoteEventDeleteInBackground({
        eventToDelete,
        calendarMetadata,
      });
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
      if (isSubscriptionLikeCalendar(calMeta)) {
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

    // 2. Background Sync
    const targetCalendarUrl = updates.calendarUrl || oldEvent.calendarUrl;

    if (targetCalendarUrl) {
      void syncRemoteEventUpdateInBackground({
        oldEvent,
        updates,
        calendarMetadata,
      });
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

    const isRightHalf = anchorRect.left - containerRect.left > containerRect.width / 2;

    let left: number | undefined;
    let right: number | undefined;

    if (isRightHalf) {
      // 우측 영역이면 오른쪽 끝을 기준으로 배치하여 벗어나지 않도록 함
      right = containerRect.right - anchorRect.right - 20; 
      if (right <= 0) right = 20;
    } else {
      left = anchorRect.left - containerRect.left + 10;
    }

    setEmotionModalPosition({ top, left, right, align: isRightHalf ? 'right' : 'left' });
    setEmotionModalDate(date);
    setIsEmotionModalOpen(true);
  }, []);

  const activeDiaryEntry = activeDiaryDate ? diaryEntries[activeDiaryDate] : undefined;

  // ── 메모이징된 파생 값 ──────────────────────────────────────────────────────
  // 매 렌더마다 새 객체/배열 생성을 방지하여 하위 컴포넌트의 memo() 최적화가 유효하게 함

  const diaryCompletionMap = useMemo(
    () => Object.keys(diaryEntries).reduce<Record<string, boolean>>((acc, date) => {
      acc[date] = true;
      return acc;
    }, {}),
    [diaryEntries]
  );

  const allCalendars = useMemo(
    () => [...calendarMetadata, ...googleCalendars],
    [calendarMetadata, googleCalendars]
  );

  const writableCalendars = useMemo(
    () => allCalendars.filter(isWritableCalendar),
    [allCalendars]
  );

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

  const handleConfirmDelete = useCallback(async () => {
    if (!calDeleteState) return;
    const { url, isCalDAV, isUnsync, isGoogle, isCreatedFromApp } = calDeleteState;

    // Close dialog
    setCalDeleteState(null);

    if (isUnsync) {
      await runCalendarUnsyncFlow({
        url,
        isGoogle,
        isCreatedFromApp,
        markUnsyncedUrl: (u) => unsyncedUrlsRef.current.add(u),
        removeGoogleCalendar,
        deleteCalendar,
        convertCalDAVToLocal,
        convertGoogleToLocal,
        deleteGoogleCalendarById,
        loadData,
        setToast,
      });
      return;
    }

    const deleteFromServer = !!(isCalDAV || isGoogle) && calDeleteOption === 'remote';
    const result = await runCalendarDeleteFlow({
      url,
      deleteFromServer,
      deleteCalendar,
      isGoogle,
      deleteGoogleCalendarById,
    });
    if (result.serverDeleteFailed && result.localDelete) {
      setServerDeleteFailedDialog({ isOpen: true, calName: calDeleteState.name, localDelete: result.localDelete });
    }
  }, [calDeleteState, calDeleteOption, deleteCalendar, loadData, removeGoogleCalendar]);


  const handleSyncComplete = useCallback(async (count: number, syncedCalendarUrls?: string[]) => {
    localStorage.removeItem('caldavAuthError');
    setIsCalDAVAuthError(false);
    setIsCalDAVCredentialsSaved(true);
    // 재동기화된 캘린더를 exclude 목록에서 제거 (다음 백그라운드 sync에서 포함되도록)
    if (syncedCalendarUrls?.length) {
      syncedCalendarUrls.forEach(u => {
        unsyncedUrlsRef.current.delete(u);
        const norm = normalizeCalendarUrl(u);
        if (norm) unsyncedUrlsRef.current.delete(norm);
      });
    }
    // 메타데이터를 먼저 갱신 (모달에서 저장한 새 캘린더 반영)
    // 주의: refreshMetadataWithServerList(syncedCalendarUrls)를 쓰면 createdFromApp 캘린더가
    // syncedCalendarUrls에 없어서 "서버에서 삭제됨"으로 잘못 처리됨 → refreshMetadata()만 호출
    refreshMetadata();
    await loadData(true);
    // 메타데이터 갱신 후 다음 틱에 sync 트리거 (모달 sync가 syncInFlight로 차단됐을 때 백업)
    setTimeout(() => triggerCalDAVSync(), 0);
    setToast({ message: '캘린더 동기화에 성공했습니다.', type: 'success' });
    if (pendingSyncCalendar) {
      const cal = pendingSyncCalendar;
      setPendingSyncCalendar(null);
      // 언마운트 시 clearTimeout으로 정리되는 안전한 타이머
      pendingSyncTimerRef.current = setTimeout(() => handleSyncToMac(cal), 500);
    }
    setCalDAVAuthNoticeMessage(undefined);
  }, [loadData, refreshMetadata, pendingSyncCalendar, handleSyncToMac, triggerCalDAVSync]);

  const handleGoogleSyncComplete = useCallback(async (selectedMeta: CalendarMetadata[]) => {
    setIsGoogleSyncModalOpen(false);
    setGoogleSyncModalMode('sync');
    setGoogleAuthNoticeMessage(undefined);
    clearGoogleTokenExpiredFlag();
    // 재동기화된 구글 캘린더를 exclude 목록에서 제거 (즉시 표시되도록)
    selectedMeta.forEach(m => {
      if (m.googleCalendarId) {
        const url = `google:${m.googleCalendarId}`;
        unsyncedUrlsRef.current.delete(url);
      }
    });
    await syncGoogleCalendar(selectedMeta);
    setToast({ message: 'Google 캘린더 동기화에 성공했습니다.', type: 'success' });
  }, [syncGoogleCalendar, clearGoogleTokenExpiredFlag]);

  const handleGoogleDisconnect = useCallback(async () => {
    const { deleteAllGoogleData } = await import('../services/api');
    const ok = await deleteAllGoogleData();
    if (ok) {
      localStorage.removeItem('googleCalendarsMeta');
      localStorage.removeItem('googleSelectedCalendarIds');
      localStorage.removeItem('googleSyncTokens');
      setIsGoogleSyncModalOpen(false);
      loadData(true);
      setToast({ message: 'Google 연동이 해제되었습니다.', type: 'success' });
    } else {
      setToast({ message: 'Google 연동 해제 중 오류가 발생했습니다.', type: 'error' });
    }
  }, [loadData]);

  const handleGoogleTokenRecovered = useCallback(() => {
    clearGoogleTokenExpiredFlag();
    const hasExistingGoogleCals = calendarMetadata.some(c => c.type === 'google');
    if (!hasExistingGoogleCals) {
      setPostAuthSyncService('google');
      setIsPostAuthSyncDialogOpen(true);
    }
  }, [clearGoogleTokenExpiredFlag, calendarMetadata]);

  const handleCalDAVDisconnectSuccess = useCallback(async () => {
    // type이 null인 오래된 CalDAV 데이터도 포함하기 위해 isCalDAVSyncTarget 사용
    const caldavUrls = calendarMetadata
      .filter(c => isCalDAVSyncTarget(c))
      .map(c => c.url);

    // unsyncedUrlsRef에 CalDAV URL 추가 → 렌더링 필터에서 즉시 제거
    // 정리는 여기서 하지 않음 — loadData(force) 완료 시 mergeEventsWithLocal이
    // excludeCalendarUrls로 state에서 제거하고, 다음 CalDAV sync 완료 시 clear()됨
    caldavUrls.forEach(u => {
      unsyncedUrlsRef.current.add(u);
      const norm = normalizeCalendarUrl(u);
      if (norm) unsyncedUrlsRef.current.add(norm);
    });

    setIsCalDAVAuthError(false);
    setIsCalDAVCredentialsSaved(false);
    refreshMetadata();
    await loadData(true, caldavUrls.length > 0 ? caldavUrls : undefined);
    setIsCalDAVModalOpen(false);
    setToast({ message: 'iCloud 연동이 해제되었습니다.', type: 'success' });
  }, [loadData, refreshMetadata, calendarMetadata]);

  const handleCalDAVAuthSuccess = useCallback(() => {
    setIsCalDAVAuthError(false);
    setToast({ message: 'iCloud와 다시 연결되었습니다.', type: 'success' });
    const hasExistingCalDAVCals = calendarMetadata.some(c => c.type === 'caldav');
    if (!hasExistingCalDAVCals) {
      setPostAuthSyncService('caldav');
      setIsPostAuthSyncDialogOpen(true);
    }
  }, [calendarMetadata]);

  const handleGoogleCalendarDeletedExternally = useCallback(async (calId: string, createdFromApp: boolean) => {
    const url = `google:${calId}`;
    const cal = calendarMetadata.find(c => c.url === url);
    const name = cal?.displayName ?? calId;
    const result = await handleGoogleExternalDelete(calId, createdFromApp, {
      calendarName: name,
      convertGoogleToLocal,
      relinkEventsByCalendarUrl,
      removeGoogleCalendar,
      deleteEventsByCalendarUrl: async (u: string) => { await deleteEventsByCalendarUrl(u); },
    });
    setToast({ message: result.message, type: result.type as 'info' });
    loadData(true);
  }, [calendarMetadata, convertGoogleToLocal, relinkEventsByCalendarUrl, removeGoogleCalendar, loadData]);

  useEffect(() => {
    if (externallyDeletedCalendars.length === 0) return;
    clearExternallyDeletedCalendars();
    externallyDeletedCalendars.forEach(({ calId, createdFromApp }) => {
      void handleGoogleCalendarDeletedExternally(calId, createdFromApp);
    });
  }, [externallyDeletedCalendars, clearExternallyDeletedCalendars, handleGoogleCalendarDeletedExternally]);

  const handleSelectionDeleteShortcut = useCallback(() => {
    if (selectedEventIds.length === 0) return;

    const validIdsToDelete = selectedEventIds.filter(id => {
      const event = events.find(ev => ev.id === id);
      if (event?.calendarUrl) {
        const calMeta = calendarMetadata.find(c => normalizeCalendarUrl(c.url) === normalizeCalendarUrl(event.calendarUrl!));
        if (isSubscriptionLikeCalendar(calMeta)) {
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
  }, [selectedEventIds, events, calendarMetadata, handleDeleteEventWrapper, clearSelection]);

  const handleCopyShortcut = useCallback(() => {
    if (selectedEventIds.length === 0) return;
    const eventToCopy = events.find(ev => ev.id === selectedEventIds[0]);
    if (eventToCopy) {
      setClipboardEvent(eventToCopy);
      console.log('Event copied:', eventToCopy.title);
    }
  }, [selectedEventIds, events, setClipboardEvent]);

  const handlePasteShortcut = useCallback(() => {
    if (!clipboardEvent || !hoveredDate) return;
    const { id: _id, caldavUid: _caldavUid, ...rest } = clipboardEvent;
    handleAddEventWrapper({
      ...rest,
      date: hoveredDate,
    });
    console.log(`Event pasted to ${hoveredDate}`);
  }, [clipboardEvent, hoveredDate, handleAddEventWrapper]);

  const handleGlobalShortcutKeyDown = useCallback((e: KeyboardEvent) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedEventIds.length > 0) {
        e.preventDefault();
        handleSelectionDeleteShortcut();
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
      handleCopyShortcut();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
      handlePasteShortcut();
    }
  }, [selectedEventIds.length, handleSelectionDeleteShortcut, handleCopyShortcut, handlePasteShortcut]);

  // --- Keyboard Selection Delete ---
  useEffect(() => {
    window.addEventListener('keydown', handleGlobalShortcutKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalShortcutKeyDown);
  }, [handleGlobalShortcutKeyDown]);

  const handleQuickAddSchedule = useCallback(() => {
    let dateToUse = activeDate;

    if (!dateToUse) {
      const dayMetas = Array.from(document.querySelectorAll('[data-date-allday]')) as HTMLElement[];
      const visibleMeta = dayMetas.find(el => el.getBoundingClientRect().top > 70);

      if (visibleMeta) {
        const weekCard = visibleMeta.closest('[data-week-id]');
        if (weekCard) {
          const weekMetas = Array.from(weekCard.querySelectorAll('[data-date-allday]')) as HTMLElement[];
          for (const meta of weekMetas) {
            const dateStr = meta.getAttribute('data-date-allday');
            if (!dateStr) continue;
            const [y, m, d] = dateStr.split('-').map(Number);
            const dateObj = new Date(y, m - 1, d);
            if (dateObj.getDay() === 1) {
              dateToUse = dateStr;
              break;
            }
          }
        }
      }
    }

    if (!dateToUse) {
      const today = new Date();
      dateToUse = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }

    const slotToUse = (activeDate && activeTimeSlot) ? activeTimeSlot : 'am';
    const alignEl = document.querySelector(`[data-date-${slotToUse}="${dateToUse}"]`) as HTMLElement | null;
    handleDateClick(dateToUse, alignEl ?? undefined, slotToUse);
  }, [activeDate, activeTimeSlot, handleDateClick]);

  return (
    <div className={styles.appLayout}>

      <AppHeader
        isCalendarPopupOpen={isCalendarPopupOpen}
        onToggleCalendarPopup={() => setIsCalendarPopupOpen(!isCalendarPopupOpen)}
        calendarPopupNode={
          isCalendarPopupOpen ? (
            <CalendarListPopup
              calendars={allCalendars}
              visibleUrlSet={visibleCalendarUrlSet}
              onToggle={toggleCalendarVisibility}
              onClose={() => setIsCalendarPopupOpen(false)}
              onAddLocalCalendar={addLocalCalendar}
              onUpdateLocalCalendar={handleUpdateLocalCalendar}
              onDeleteCalendar={handleDeleteCalendar}
              onSyncSwitchToggle={handleSyncSwitchToggle}
              onOpenCalDAVModal={() => {
                setCalDAVModalMode('sync');
                setCalDAVAuthNoticeMessage(undefined);
                setIsCalDAVModalOpen(true);
              }}
              onOpenSubscribeModal={() => {
                setIsSubscribeModalOpen(true);
              }}
              onOpenGoogleSync={() => {
                setGoogleSyncModalMode('sync');
                setGoogleAuthNoticeMessage(undefined);
                setIsGoogleSyncModalOpen(true);
              }}
              isSyncingGoogle={isSyncingGoogle}
              hasGoogleProvider={hasGoogleProvider}
              isGoogleTokenExpired={isGoogleTokenExpired}
              isCalDAVAuthError={isCalDAVAuthError}
              isCalDAVCredentialsSaved={isCalDAVCredentialsSaved}
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
        onAddSchedule={handleQuickAddSchedule}
        onToggleProfileMenu={handleToggleProfileMenu}
        onLogout={handleLogout}

        onOpenRoutine={handleOpenRoutineFromHeader}
        showRoutines={showRoutines}
        onToggleRoutines={handleToggleRoutines}
        showDiary={showDiary}
        onToggleDiary={handleToggleDiary}
        showEmotion={showEmotion}
        onToggleEmotion={handleToggleEmotion}
        showTodos={showTodos}
        onToggleTodos={handleToggleTodos}
        onOpenSettings={handleOpenSettingsFromHeader}
        onOpenTimeSettings={handleOpenTimeSettingsFromHeader}
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
          diaryCompletionMap={diaryCompletionMap}
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
          calendars={writableCalendars}
          allCalendars={allCalendars}
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
          calDAVAuthNoticeMessage={calDAVAuthNoticeMessage}
          onSyncComplete={handleSyncComplete}
          onCloseGoogleSyncModal={() => setIsGoogleSyncModalOpen(false)}
          onGoogleSyncComplete={handleGoogleSyncComplete}
          onGoogleDisconnect={handleGoogleDisconnect}
          googleCalendars={googleCalendars}
          googleSyncMode={googleSyncModalMode}
          googleAuthNoticeMessage={googleAuthNoticeMessage}
          onCalDAVAuthSuccess={handleCalDAVAuthSuccess}
          onCalDAVDisconnectSuccess={handleCalDAVDisconnectSuccess}
          onGoogleTokenRecovered={handleGoogleTokenRecovered}
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
            onSubscribeSuccess={handleSubscribeSuccess}
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
            ? calDeleteState?.isCreatedFromApp
              ? `'${calDeleteState?.name}' 동기화를 해제합니다. Riff 캘린더와 일정은 보존됩니다.`
              : `'${calDeleteState?.name}' 동기화를 해제합니다. Riff에 저장된 해당 캘린더의 일정도 모두 삭제됩니다.`
            : ((calDeleteState?.isCalDAV || calDeleteState?.isGoogle) ? undefined : `'${calDeleteState?.name}'를 삭제하시겠습니까?`)
        }
        confirmText="확인"
        cancelText="취소"
        onConfirm={handleConfirmDelete}
        onCancel={() => setCalDeleteState(null)}
        onClose={() => setCalDeleteState(null)}
      >
        {(calDeleteState?.isCalDAV || calDeleteState?.isGoogle) && !calDeleteState?.isUnsync && (
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
              {calDeleteState?.isGoogle ? 'Google 캘린더에서도 삭제' : 'iCloud까지 모두 삭제'}
            </label>
          </div>
        )}
      </ConfirmDialog>

      {/* Server Delete Failed Dialog */}
      <ConfirmDialog
        isOpen={serverDeleteFailedDialog.isOpen}
        title="서버 삭제 실패"
        message={`'${serverDeleteFailedDialog.calName}' 서버 삭제에 실패했습니다. Riff에서만 삭제하시겠습니까?`}
        confirmText="Riff에서만 삭제"
        cancelText="취소"
        onConfirm={async () => {
          setServerDeleteFailedDialog({ isOpen: false, calName: '' });
          await serverDeleteFailedDialog.localDelete?.();
        }}
        onCancel={() => setServerDeleteFailedDialog({ isOpen: false, calName: '' })}
      />

      {/* Post-Auth Sync Suggestion Dialog */}
      <ConfirmDialog
        isOpen={isPostAuthSyncDialogOpen}
        title={postAuthSyncService === 'caldav' ? 'iCloud 캘린더 동기화' : 'Google 캘린더 동기화'}
        message={postAuthSyncService === 'caldav'
          ? '계속해서 iCloud 캘린더 동기화를 설정하시겠습니까?'
          : '계속해서 Google 캘린더 동기화를 설정하시겠습니까?'}
        confirmText="설정하기"
        cancelText="취소"
        onConfirm={() => {
          setIsPostAuthSyncDialogOpen(false);
          if (postAuthSyncService === 'caldav') {
            setCalDAVModalMode('sync');
            setCalDAVAuthNoticeMessage(undefined);
            setIsCalDAVModalOpen(true);
          } else {
            setGoogleSyncModalMode('sync');
            setGoogleAuthNoticeMessage(undefined);
            setIsGoogleSyncModalOpen(true);
          }
        }}
        onCancel={() => setIsPostAuthSyncDialogOpen(false)}
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
      {/* --- Emotion Modal --- */}
      {isEmotionModalOpen && emotionModalDate && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10000 }}>
          <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'auto' }}>
            <EmotionModal
              date={emotionModalDate}
              position={emotionModalPosition}
              currentEmotion={emotions?.[emotionModalDate]}
              onSelect={(emoji) => {
                setEmotion(emotionModalDate, emoji || '');
              }}
              onClose={() => setIsEmotionModalOpen(false)}
            />
          </div>
        </div>
      )}

    </div>
  );
};