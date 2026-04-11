import { useCallback, useEffect } from 'react';
import { CalendarMetadata } from '../services/api';
import { syncLocalCalendarToMac, syncCalendarNameToRemote } from '../services/calendarMacSyncFlow';
import { syncLocalCalendarToGoogle } from '../services/calendarGoogleSyncFlow';
import { buildCalendarDeleteState } from '../services/calendarDeleteFlow';
import { CalendarDeleteState } from '../services/calendarDeleteFlow';
import { getGoogleProviderToken } from '../lib/googleCalendar';

const PENDING_GOOGLE_LOCAL_SYNC_KEY = 'pendingGoogleLocalCalendarSync';
const PENDING_GOOGLE_AUTH_CONTEXT_KEY = 'pendingGoogleAuthContext';
const RIFF_TO_GOOGLE_CONTEXT = 'riff-to-google';

type ToastPayload = { message: string; type: 'loading' | 'success' | 'error' | 'info' };
type SetToast = (toast: ToastPayload | null) => void;
type ConfirmDialogPayload = { isOpen: boolean; title?: string; message: string; onConfirm?: () => void };
type SetConfirmDialog = (dialog: ConfirmDialogPayload) => void;

export interface UseSyncHandlersOptions {
  // Calendar metadata & operations (from useCalendarMetadata / useData)
  calendarMetadata: CalendarMetadata[];
  googleCalendars: CalendarMetadata[];
  calendarMetadataRef: React.MutableRefObject<CalendarMetadata[]>;
  convertLocalToCalDAV: (oldUrl: string, cal: CalendarMetadata) => void;
  convertLocalToGoogle: (oldUrl: string, cal: CalendarMetadata) => void;
  updateLocalCalendar: (url: string, updates: Partial<CalendarMetadata>) => void;
  clearGoogleTokenExpiredFlag: () => void;
  // Mutable refs (stable, no re-render cost)
  googleLocalSyncInFlightRef: React.MutableRefObject<Set<string>>;
  googlePendingRecoveryInFlightRef: React.MutableRefObject<boolean>;
  // Delete dialog state (for handleDeleteCalendar)
  setCalDeleteState: (state: CalendarDeleteState | null) => void;
  setCalDeleteOption: (v: 'local' | 'remote') => void;
  // UI callbacks (all stable React state setters)
  setToast: SetToast;
  setConfirmDialog: SetConfirmDialog;
  setHiddenCalendarUrls: React.Dispatch<React.SetStateAction<Set<string>>>;
  setPendingSyncCalendar: (cal: CalendarMetadata | null) => void;
  setIsCalDAVModalOpen: (v: boolean) => void;
  setCalDAVModalMode: (mode: 'sync' | 'auth-only') => void;
  setCalDAVAuthNoticeMessage: (msg: string | undefined) => void;
  setIsGoogleSyncModalOpen: (v: boolean) => void;
  setGoogleSyncModalMode: (mode: 'sync' | 'auth-only') => void;
  setGoogleAuthNoticeMessage: (msg: string | undefined) => void;
  closeAllModals: () => void;
}

export const useSyncHandlers = ({
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
  closeAllModals,
}: UseSyncHandlersOptions) => {
  // ── handleUpdateLocalCalendar ────────────────────────────────────────────
  const handleUpdateLocalCalendar = useCallback(
    async (url: string, updates: Partial<CalendarMetadata>) => {
      updateLocalCalendar(url, updates);
      if (updates.displayName) {
        await syncCalendarNameToRemote(url, updates.displayName, calendarMetadata);
      }
    },
    [calendarMetadata, updateLocalCalendar]
  );

  // ── handleSyncToMac ──────────────────────────────────────────────────────
  const handleSyncToMac = useCallback(
    async (calendar: CalendarMetadata) => {
      try {
        setToast({ message: 'Mac 캘린더에 추가 중...', type: 'loading' });
        const result = await syncLocalCalendarToMac(calendar);

        if (result.status === 'needs-auth') {
          setPendingSyncCalendar(calendar);
          setCalDAVModalMode('auth-only');
          setCalDAVAuthNoticeMessage(
            'iCloud 앱 전용 비밀번호가 만료되었거나 해제되어 다시 입력이 필요합니다.'
          );
          setIsCalDAVModalOpen(true);
          setToast(null);
          return;
        }

        if (result.status === 'error') {
          console.error('Mac 캘린더 생성 실패:', result.message);
          setToast(null);
          setConfirmDialog({
            isOpen: true,
            title: '오류',
            message: `Mac 캘린더 생성 실패: ${result.message}`,
          });
          return;
        }

        convertLocalToCalDAV(calendar.url, result.newCalendar);
        setCalDAVAuthNoticeMessage(undefined);
        setHiddenCalendarUrls(prev => {
          if (prev.has(calendar.url) || prev.has(result.remoteCalendarUrl)) {
            const next = new Set(prev);
            next.delete(result.remoteCalendarUrl);
            localStorage.setItem('riffHiddenCalendars', JSON.stringify(Array.from(next)));
            return next;
          }
          return prev;
        });
        setToast({ message: 'Mac 캘린더에 추가되었습니다.', type: 'success' });
      } catch (e) {
        console.error('Sync failed:', e);
        setToast(null);
        setConfirmDialog({ isOpen: true, title: '오류', message: '동기화 중 오류가 발생했습니다.' });
      }
    },
    [convertLocalToCalDAV]
  );

  // ── handleSyncToGoogle ───────────────────────────────────────────────────
  const handleSyncToGoogle = useCallback(
    async (calendar: CalendarMetadata) => {
      if (googleLocalSyncInFlightRef.current.has(calendar.url)) return;
      const stillLocal = calendarMetadataRef.current.some(
        c => c.url === calendar.url && c.isLocal
      );
      if (!stillLocal) return;

      googleLocalSyncInFlightRef.current.add(calendar.url);
      try {
        setToast({ message: 'Google 캘린더에 추가 중...', type: 'loading' });
        const result = await syncLocalCalendarToGoogle(calendar);

        if (result.status === 'needs-auth') {
          localStorage.setItem(PENDING_GOOGLE_LOCAL_SYNC_KEY, JSON.stringify(calendar));
          // 인증 복귀 후 MainLayout이 Riff<-Google 안내 팝업을 띄우지 않도록 컨텍스트 표시
          localStorage.setItem(PENDING_GOOGLE_AUTH_CONTEXT_KEY, RIFF_TO_GOOGLE_CONTEXT);
          setGoogleSyncModalMode('auth-only');
          setGoogleAuthNoticeMessage(
            'Google 계정 연결이 만료되었거나 해제되었습니다. 다시 연결 후 동기화를 진행해주세요.'
          );
          setIsGoogleSyncModalOpen(true);
          setToast(null);
          return;
        }

        if (result.status === 'error') {
          setToast(null);
          setConfirmDialog({
            isOpen: true,
            title: '오류',
            message: `Google 캘린더 생성 실패: ${result.message}`,
          });
          return;
        }

        convertLocalToGoogle(calendar.url, result.newCalendar);
        localStorage.removeItem(PENDING_GOOGLE_LOCAL_SYNC_KEY);
        localStorage.removeItem(PENDING_GOOGLE_AUTH_CONTEXT_KEY);
        clearGoogleTokenExpiredFlag();
        setGoogleAuthNoticeMessage(undefined);
        setToast({ message: 'Google 캘린더에 추가되었습니다.', type: 'success' });
      } catch (e) {
        console.error('Google sync failed:', e);
        setToast({ message: 'Google 캘린더 추가 중 오류가 발생했습니다.', type: 'error' });
      } finally {
        googleLocalSyncInFlightRef.current.delete(calendar.url);
      }
    },
    [convertLocalToGoogle, clearGoogleTokenExpiredFlag]
  );

  // pending Google local sync 복구 (visibility / focus 이벤트)
  useEffect(() => {
    const tryResumePendingGoogleLocalSync = async () => {
      if (googlePendingRecoveryInFlightRef.current) return;
      googlePendingRecoveryInFlightRef.current = true;

      const raw = localStorage.getItem(PENDING_GOOGLE_LOCAL_SYNC_KEY);
      if (!raw) {
        googlePendingRecoveryInFlightRef.current = false;
        return;
      }
      localStorage.removeItem(PENDING_GOOGLE_LOCAL_SYNC_KEY);

      const token = await getGoogleProviderToken();
      if (!token) {
        localStorage.setItem(PENDING_GOOGLE_LOCAL_SYNC_KEY, raw);
        googlePendingRecoveryInFlightRef.current = false;
        return;
      }

      clearGoogleTokenExpiredFlag();
      try {
        const pending = JSON.parse(raw) as CalendarMetadata;
        setGoogleSyncModalMode('sync');
        setGoogleAuthNoticeMessage(undefined);
        await handleSyncToGoogle(pending);
      } catch (e) {
        console.warn('[Google] pending 로컬 캘린더 동기화 복구 실패:', e);
      } finally {
        googlePendingRecoveryInFlightRef.current = false;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void tryResumePendingGoogleLocalSync();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    void tryResumePendingGoogleLocalSync();
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [handleSyncToGoogle, clearGoogleTokenExpiredFlag]);

  // ── handleDualSyncToGoogle ───────────────────────────────────────────────
  // iCloud primary 캘린더에 Google secondary 추가 (URL 변경 없이 googleCalendarId만 추가)
  const handleDualSyncToGoogle = useCallback(
    async (cal: CalendarMetadata) => {
      if (googleLocalSyncInFlightRef.current.has(cal.url)) return;
      googleLocalSyncInFlightRef.current.add(cal.url);
      try {
        setToast({ message: 'Google 캘린더에 추가 중...', type: 'loading' });
        const result = await syncLocalCalendarToGoogle(cal);

        if (result.status === 'needs-auth') {
          localStorage.setItem(PENDING_GOOGLE_AUTH_CONTEXT_KEY, RIFF_TO_GOOGLE_CONTEXT);
          setGoogleSyncModalMode('auth-only');
          setGoogleAuthNoticeMessage(
            'Google 계정 연결이 만료되었거나 해제되었습니다. 다시 연결 후 동기화를 진행해주세요.'
          );
          setIsGoogleSyncModalOpen(true);
          setToast(null);
          return;
        }
        if (result.status === 'error') {
          setToast(null);
          setConfirmDialog({
            isOpen: true,
            title: '오류',
            message: `Google 캘린더 생성 실패: ${result.message}`,
          });
          return;
        }

        updateLocalCalendar(cal.url, { googleCalendarId: result.newCalendar.googleCalendarId });
        localStorage.removeItem(PENDING_GOOGLE_AUTH_CONTEXT_KEY);
        clearGoogleTokenExpiredFlag();
        setToast({ message: 'Google 캘린더에도 동기화되었습니다.', type: 'success' });
      } catch (e) {
        console.error('Dual Google sync failed:', e);
        setToast({ message: 'Google 동기화 중 오류가 발생했습니다.', type: 'error' });
      } finally {
        googleLocalSyncInFlightRef.current.delete(cal.url);
      }
    },
    [updateLocalCalendar, clearGoogleTokenExpiredFlag]
  );

  // ── handleDualSyncToCalDAV ───────────────────────────────────────────────
  // Google primary 캘린더에 iCloud secondary 추가 (URL 변경 없이 caldavSyncUrl만 추가)
  const handleDualSyncToCalDAV = useCallback(
    async (cal: CalendarMetadata) => {
      try {
        setToast({ message: 'iCloud 캘린더에 추가 중...', type: 'loading' });
        const result = await syncLocalCalendarToMac(cal);

        if (result.status === 'needs-auth') {
          setCalDAVModalMode('auth-only');
          setCalDAVAuthNoticeMessage(
            'iCloud 앱 전용 비밀번호가 만료되었거나 해제되어 다시 입력이 필요합니다.'
          );
          setIsCalDAVModalOpen(true);
          setToast(null);
          return;
        }
        if (result.status === 'error') {
          setToast(null);
          setConfirmDialog({
            isOpen: true,
            title: '오류',
            message: `iCloud 캘린더 생성 실패: ${result.message}`,
          });
          return;
        }

        updateLocalCalendar(cal.url, { caldavSyncUrl: result.newCalendar.url });
        setToast({ message: 'iCloud 캘린더에도 동기화되었습니다.', type: 'success' });
      } catch (e) {
        console.error('Dual CalDAV sync failed:', e);
        setToast({ message: 'iCloud 동기화 중 오류가 발생했습니다.', type: 'error' });
      }
    },
    [updateLocalCalendar]
  );

  // ── handleDeleteCalendar ─────────────────────────────────────────────────
  const handleDeleteCalendar = useCallback(
    (url: string, actionType?: 'unsync' | 'delete') => {
      const nextState = buildCalendarDeleteState(url, actionType, calendarMetadata, googleCalendars);
      if (!nextState) return;
      if (!nextState.isUnsync) setCalDeleteOption('local');
      setCalDeleteState(nextState);
    },
    [calendarMetadata, googleCalendars]
  );

  // ── handleSyncSwitchToggle ───────────────────────────────────────────────
  const handleSyncSwitchToggle = useCallback(
    async (
      cal: CalendarMetadata,
      service: 'icloud' | 'google',
      action: 'sync' | 'unsync' | 'reconnect'
    ) => {
      if (action === 'reconnect') {
        closeAllModals();
        if (service === 'icloud') {
          setCalDAVModalMode('auth-only');
          setCalDAVAuthNoticeMessage(
            'iCloud 앱 전용 비밀번호가 만료되었거나 해제되어 다시 입력이 필요합니다.'
          );
          setIsCalDAVModalOpen(true);
        } else {
          setGoogleSyncModalMode('auth-only');
          setGoogleAuthNoticeMessage('Google 계정 연결이 만료되었습니다. 다시 연결해주세요.');
          setIsGoogleSyncModalOpen(true);
        }
        return;
      }

      if (action === 'sync') {
        if (service === 'icloud') {
          if (cal.type === 'google' && cal.createdFromApp) {
            await handleDualSyncToCalDAV(cal);
          } else {
            await handleSyncToMac(cal);
          }
        } else {
          if (cal.type === 'caldav' && cal.createdFromApp) {
            await handleDualSyncToGoogle(cal);
          } else {
            await handleSyncToGoogle(cal);
          }
        }
        return;
      }

      // action === 'unsync'
      if (service === 'icloud') {
        const isEffectivelyCalDAV =
          cal.type === 'caldav' ||
          (!cal.isLocal && !cal.createdFromApp && cal.type !== 'google');
        if (isEffectivelyCalDAV) {
          handleDeleteCalendar(cal.url, 'unsync');
        } else if (cal.type === 'google' && cal.caldavSyncUrl) {
          await handleUpdateLocalCalendar(cal.url, { caldavSyncUrl: undefined });
          setToast({ message: 'iCloud 동기화가 해제되었습니다.', type: 'success' });
        }
      } else {
        if (cal.type === 'google') {
          handleDeleteCalendar(cal.url, 'unsync');
        } else if (cal.type === 'caldav' && cal.googleCalendarId) {
          await handleUpdateLocalCalendar(cal.url, { googleCalendarId: undefined });
          setToast({ message: 'Google 동기화가 해제되었습니다.', type: 'success' });
        }
      }
    },
    [
      handleSyncToMac,
      handleSyncToGoogle,
      handleDeleteCalendar,
      handleUpdateLocalCalendar,
      handleDualSyncToGoogle,
      handleDualSyncToCalDAV,
    ]
  );

  return {
    handleUpdateLocalCalendar,
    handleSyncToMac,
    handleSyncToGoogle,
    handleDualSyncToGoogle,
    handleDualSyncToCalDAV,
    handleDeleteCalendar,
    handleSyncSwitchToggle,
  };
};
