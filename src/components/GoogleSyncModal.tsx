import { useState, useEffect, useCallback } from 'react';
import { getGoogleProviderToken, fetchGoogleCalendarList, GoogleCalendar } from '../lib/googleCalendar';
import { CalendarMetadata } from '../services/api';
import styles from './CalDAVSyncModal.module.css';
import shared from './SharedModal.module.css';

interface GoogleSyncModalProps {
  onClose: () => void;
  onSyncComplete: (selectedCalendars: CalendarMetadata[]) => void;
  onDisconnect: () => void;
  existingGoogleCalendars: CalendarMetadata[];
  mode?: 'sync' | 'auth-only';
  authNoticeMessage?: string;
  onTokenRecovered?: () => void;
}

export function GoogleSyncModal({
  onClose,
  onSyncComplete,
  onDisconnect,
  existingGoogleCalendars,
  mode = 'sync',
  authNoticeMessage,
  onTokenRecovered,
}: GoogleSyncModalProps) {
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasExistingSync = existingGoogleCalendars.length > 0;

  const loadCalendars = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getGoogleProviderToken();
      if (!token) {
        setError('require_auth');
        setLoading(false);
        return;
      }
      onTokenRecovered?.();
      if (mode === 'auth-only') {
        onClose();
        return;
      }
      const list = await fetchGoogleCalendarList(token);
      setCalendars(list);

      // Pre-select already-synced calendars
      const existingIds = new Set(existingGoogleCalendars.map(c => c.googleCalendarId!));
      if (existingIds.size > 0) {
        setSelectedIds(existingIds);
      } else {
        // First time: select all by default
        setSelectedIds(new Set(list.map(c => c.id)));
      }
    } catch (err: any) {
      setError('캘린더 목록을 불러오지 못했습니다: ' + (err?.message ?? ''));
    } finally {
      setLoading(false);
    }
  }, [existingGoogleCalendars, mode, onClose, onTokenRecovered]);

  // Auto-fetch calendar list on mount
  useEffect(() => {
    void loadCalendars();
  }, [loadCalendars]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && error === 'require_auth') {
        void loadCalendars();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [error, loadCalendars]);

  const toggleCalendar = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === calendars.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(calendars.map(c => c.id)));
    }
  };

  const handleSync = async () => {
    if (selectedIds.size === 0) {
      setError('동기화할 캘린더를 선택해주세요.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const selected = calendars
        .filter(c => selectedIds.has(c.id))
        .map<CalendarMetadata>(gc => ({
          url: `google:${gc.id}`,
          displayName: gc.summary,
          color: gc.backgroundColor,
          type: 'google',
          googleCalendarId: gc.id,
          readOnly: gc.accessRole === 'reader' || gc.accessRole === 'freeBusyReader',
          isVisible: true,
        }));
      onSyncComplete(selected);
    } catch (err: any) {
      setError(err?.message ?? '동기화 중 오류가 발생했습니다.');
      setSyncing(false);
    }
  };

  return (
    <div id="google-sync-modal-container" className={shared.modalOverlay}>
      <div className={shared.modalBackdrop} onClick={onClose} />
      <div className={shared.modal}>
        <div className={shared.modalHeader}>
          <div className={shared.modalHeaderSpacer} />
          <div className={shared.modalTitle}>Google 캘린더 선택</div>
          <div className={shared.modalHeaderSpacerEnd}>
            <button onClick={onClose} className={shared.modalCloseButton}>
              <span className={`material-symbols-rounded ${shared.modalCloseIcon}`}>close</span>
            </button>
          </div>
        </div>

        <div className={shared.modalContent}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '2rem 0' }}>
              <div className={styles.spinner} />
              <span style={{ fontSize: '0.9rem', color: '#6b7280' }}>캘린더 목록을 불러오는 중...</span>
            </div>
          ) : error === 'require_auth' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '2rem 0' }}>
              <div className={styles.errorMessage} style={{ textAlign: 'center' }}>
                {authNoticeMessage || '구글 캘린더 동기화를 위해 구글 계정 연결이 필요합니다.'}
              </div>
              <button
                onClick={async () => {
                  try {
                    const { supabase } = await import('../lib/supabase');
                    const { data, error } = await supabase.auth.signInWithOAuth({
                      provider: 'google',
                      options: {
                        redirectTo: window.location.origin,
                        queryParams: { access_type: 'offline', prompt: 'consent' },
                        scopes: 'https://www.googleapis.com/auth/calendar',
                        skipBrowserRedirect: true,
                      },
                    });
                    if (error) throw error;
                    if (data?.url) {
                      window.open(data.url, '_blank', 'noopener,noreferrer');
                    }
                  } catch (e) {
                    console.error('Google Auth Failed:', e);
                  }
                }}
                className={styles.syncButton}
                style={{ width: 'auto', padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>login</span>
                Google 계정 연결하기
              </button>
            </div>
          ) : error && calendars.length === 0 ? (
            <div className={styles.errorMessage}>{error}</div>
          ) : (
            <div className={`${styles.section} ${styles.selectionSection}`}>
              {/* 전체 선택 */}
              <div className={styles.selectAllRow}>
                <label className={styles.selectAllLabel}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === calendars.length && calendars.length > 0}
                    onChange={toggleAll}
                    disabled={syncing}
                    className={styles.checkboxInput}
                  />
                  <span>전체 선택</span>
                </label>
              </div>

              {/* 캘린더 목록 */}
              <div className={styles.calendarList}>
                {calendars.map(cal => (
                  <label key={cal.id} className={styles.calendarItem}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(cal.id)}
                      onChange={() => toggleCalendar(cal.id)}
                      disabled={syncing}
                      style={{ '--cal-color': cal.backgroundColor } as React.CSSProperties}
                    />
                    <span>{cal.summary}</span>
                  </label>
                ))}
              </div>

              {/* 동기화 버튼 */}
              <button
                onClick={handleSync}
                disabled={syncing || selectedIds.size === 0}
                className={`${styles.syncButton} ${styles.syncButtonMargin}`}
              >
                {syncing ? '동기화 중...' : `선택한 ${selectedIds.size}개 캘린더 동기화`}
              </button>

              {/* 연동 해제 버튼 (이미 동기화된 경우만 표시) */}
              {hasExistingSync && (
                <button
                  onClick={onDisconnect}
                  disabled={syncing}
                  className={styles.disconnectButton}
                >
                  Google 연동 해제 및 데이터 삭제
                </button>
              )}
            </div>
          )}

          {error && error !== 'require_auth' && calendars.length > 0 && (
            <div className={styles.errorMessage}>{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
