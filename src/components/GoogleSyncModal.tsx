import { useState, useEffect, useCallback, useRef } from 'react';
import { getGoogleProviderToken, fetchGoogleCalendarList, clearCachedGoogleToken, setCachedGoogleToken, GoogleCalendar } from '../lib/googleCalendar';
import { CalendarMetadata } from '../services/api';
import { supabase, supabaseAnonKey } from '../lib/supabase';

const SUPABASE_FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1';
import styles from './CalDAVSyncModal.module.css';
import shared from './SharedModal.module.css';

interface GoogleSyncModalProps {
  onClose: () => void;
  onSyncComplete: (selectedCalendars: CalendarMetadata[]) => void | Promise<void>;
  onDisconnect: () => void;
  existingGoogleCalendars: CalendarMetadata[];
  hasGoogleProvider?: boolean;
  mode?: 'sync' | 'auth-only';
  authNoticeMessage?: string;
  onTokenRecovered?: () => void;
}

export function GoogleSyncModal({
  onClose,
  onSyncComplete,
  onDisconnect,
  existingGoogleCalendars,
  hasGoogleProvider = false,
  mode = 'sync',
  authNoticeMessage,
  onTokenRecovered,
}: GoogleSyncModalProps) {
  const [step, setStep] = useState<'account' | 'selection'>('account');
  const [isConnected, setIsConnected] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRecoveredCalledRef = useRef(false);
  const authFlowStartedRef = useRef(false);
  const oauthHandledRef = useRef(false);
  const handleGoToSelectionRef = useRef<() => Promise<void>>(() => Promise.resolve());


  const loadConnectedAccount = useCallback(async () => {
    const token = await getGoogleProviderToken();
    if (!token) {
      setIsConnected(false);
      return null;
    }

    setIsConnected(true);
    const { supabase } = await import('../lib/supabase');
    const { data } = await supabase.auth.getSession();
    setUserEmail(data.session?.user?.email ?? null);
    return token;
  }, []);

  const buildSelectedCalendars = useCallback((list: GoogleCalendar[], ids: Set<string>) => {
    return list
      .filter(c => ids.has(c.id))
      .map<CalendarMetadata>(gc => ({
        url: `google:${gc.id}`,
        displayName: gc.summary,
        color: gc.backgroundColor,
        type: 'google',
        googleCalendarId: gc.id,
        readOnly: gc.accessRole === 'reader' || gc.accessRole === 'freeBusyReader',
        isVisible: true,
      }));
  }, []);

  const runSelectedSync = useCallback(async (list: GoogleCalendar[], ids: Set<string>) => {
    const selected = buildSelectedCalendars(list, ids);
    if (selected.length === 0) {
      setError('동기화할 캘린더를 선택해주세요.');
      setSyncing(false);
      return;
    }

    setSyncing(true);
    await Promise.resolve(onSyncComplete(selected));
  }, [buildSelectedCalendars, onSyncComplete]);

  const handleOAuthRecovered = useCallback(async () => {
    if (oauthHandledRef.current) return;
    oauthHandledRef.current = true;
    setLoading(true);
    setError(null);

    try {
      // Edge Function 실패 캐시 초기화 후 토큰 획득
      clearCachedGoogleToken();

      const token = await loadConnectedAccount();
      if (!token) {
        oauthHandledRef.current = false;
        setError('Google 계정 연결을 확인하지 못했습니다. 다시 시도해주세요.');
        return;
      }

      if (mode === 'auth-only') {
        if (!tokenRecoveredCalledRef.current) {
          tokenRecoveredCalledRef.current = true;
          onTokenRecovered?.();
        }
        onClose();
        return;
      }

      const list = await fetchGoogleCalendarList(token);
      setCalendars(list);

      const existingIds = new Set(existingGoogleCalendars.map(c => c.googleCalendarId!).filter(Boolean));
      const nextSelectedIds = existingIds.size > 0 ? existingIds : new Set(list.map(c => c.id));
      setSelectedIds(nextSelectedIds);

      if (authFlowStartedRef.current) {
        await runSelectedSync(list, nextSelectedIds);
        return;
      }

      setStep('selection');
    } catch (err: any) {
      oauthHandledRef.current = false;
      setSyncing(false);
      setError('Google 계정 연결 후 동기화를 완료하지 못했습니다: ' + (err?.message ?? ''));
    } finally {
      setLoading(false);
    }
  }, [
    existingGoogleCalendars,
    loadConnectedAccount,
    mode,
    onClose,
    onTokenRecovered,
    runSelectedSync,
  ]);

  // Mount: 토큰 확인 + linkIdentity 리다이렉트 복귀 감지
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        // Google OAuth 직접 처리 복귀 감지 (sessionStorage 플래그 + URL code 파라미터)
        const justLinked = sessionStorage.getItem('googleLinkPending') === '1';
        if (justLinked) {
          sessionStorage.removeItem('googleLinkPending');
          // URL에서 code 파라미터 추출 후 Edge Function으로 교환
          const params = new URLSearchParams(window.location.search);
          const code = params.get('code');
          if (code) {
            // URL 정리 (code는 1회용이므로 즉시 제거)
            history.replaceState({}, '', window.location.pathname);
            const { data: { session } } = await supabase.auth.getSession();
            const accessToken = session?.access_token;
            if (accessToken) {
              const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/refresh-google-token`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${accessToken}`,
                  'apikey': supabaseAnonKey,
                },
                body: JSON.stringify({ action: 'exchange', code, redirectUri: window.location.origin }),
              });
              if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                setError('Google 토큰 교환 실패: ' + (err?.error ?? ''));
                return;
              }
              // access_token 캐시에 저장
              const { access_token, expires_in } = await resp.json();
              if (access_token) {
                setCachedGoogleToken(access_token, expires_in ?? 3300);
              }
            }
          }
          await handleOAuthRecovered();
          return;
        }

        const token = await loadConnectedAccount();
        if (mode === 'auth-only' && token) {
          if (!tokenRecoveredCalledRef.current) {
            tokenRecoveredCalledRef.current = true;
            onTokenRecovered?.();
          }
          onClose();
          return;
        }
        // Google 로그인 유저 + sync 모드 + 토큰 만료 아님 + 동기화된 캘린더 없음
        // → account 단계 건너뛰고 바로 캘린더 선택으로 진입
        if (hasGoogleProvider && mode === 'sync' && !authNoticeMessage && token && existingGoogleCalendars.length === 0) {
          await handleGoToSelectionRef.current();
          return;
        }
      } finally {
        setLoading(false);
      }
    };
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 탭 복귀 시 account 단계 + 미연결 상태면 재확인
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && step === 'account' && !isConnected) {
        if (authFlowStartedRef.current) {
          void handleOAuthRecovered();
          return;
        }
        void loadConnectedAccount();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [handleOAuthRecovered, isConnected, loadConnectedAccount, step]);


  // "구글 캘린더 선택" 버튼 클릭 시 캘린더 목록 fetch 후 selection 단계로
  const handleGoToSelection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getGoogleProviderToken();
      if (!token) {
        setIsConnected(false);
        return;
      }
      const list = await fetchGoogleCalendarList(token);
      setCalendars(list);

      const existingIds = new Set(existingGoogleCalendars.map(c => c.googleCalendarId!));
      if (existingIds.size > 0) {
        setSelectedIds(existingIds);
      } else {
        setSelectedIds(new Set(list.map(c => c.id)));
      }
      setStep('selection');
    } catch (err: any) {
      setError('캘린더 목록을 불러오지 못했습니다: ' + (err?.message ?? ''));
    } finally {
      setLoading(false);
    }
  }, [existingGoogleCalendars]);

  useEffect(() => { handleGoToSelectionRef.current = handleGoToSelection; }, [handleGoToSelection]);

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
      onDisconnect();
      return;
    }
    setError(null);
    try {
      await runSelectedSync(calendars, selectedIds);
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
          <div className={shared.modalHeaderSpacer}>
            {step === 'selection' && (
              <button onClick={() => setStep('account')} className={shared.backButton} aria-label="뒤로">
                <span className={`material-symbols-rounded ${shared.backIcon}`}>arrow_back_ios</span>
              </button>
            )}
          </div>
          <div className={shared.modalTitle}>
            {step === 'account' ? '계정연결' : '캘린더 선택'}
          </div>
          <div className={shared.modalHeaderSpacerEnd}>
            <button onClick={onClose} className={shared.modalCloseButton}>
              <span className={`material-symbols-rounded ${shared.modalCloseIcon}`}>close</span>
            </button>
          </div>
        </div>

        <div className={shared.modalContent}>
          {step === 'account' ? (
            /* Account 단계 */
            loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '2rem 0' }}>
                <div className={styles.spinner} style={{ borderColor: '#9333ea', borderTopColor: 'transparent' }} />
                <span style={{ fontSize: '0.9rem', color: '#6b7280' }}>확인 중...</span>
              </div>
            ) : (
              <div className={styles.accountSection}>
                {authNoticeMessage && (
                  <div className={styles.errorMessage} style={{ marginBottom: '0.75rem' }}>
                    {authNoticeMessage}
                  </div>
                )}

                {isConnected ? (
                  /* 연결된 상태 */
                  <div className={styles.accountInfo}>
                    <span className="material-symbols-rounded" style={{ fontSize: '20px', color: '#6b7280' }}>account_circle</span>
                    <span className={styles.accountEmail}>{userEmail ?? 'Google 계정 연결됨'}</span>
                  </div>
                ) : (
                  /* 미연결 상태: OAuth 버튼 */
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '0.5rem 0' }}>
                    <p style={{ fontSize: '0.85rem', color: '#6b7280', textAlign: 'center', margin: 0 }}>
                      {authNoticeMessage || 'Google 캘린더 동기화를 위해 계정 연결이 필요합니다.'}
                    </p>
                    <button
                      onClick={async () => {
                        try {
                          // Supabase identity 연결 없이 Google OAuth를 직접 처리
                          // → identity_already_exists 에러 완전 회피
                          const { data: { session } } = await supabase.auth.getSession();
                          const accessToken = session?.access_token;
                          if (!accessToken) throw new Error('로그인이 필요합니다.');

                          const redirectUri = window.location.origin;
                          const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/refresh-google-token`, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${accessToken}`,
                              'apikey': supabaseAnonKey,
                            },
                            body: JSON.stringify({ action: 'getAuthUrl', redirectUri }),
                          });
                          if (!resp.ok) throw new Error('Google OAuth URL 생성 실패');
                          const { url } = await resp.json();
                          // 플래그 세팅 직후 이동 → 복귀 시 모달 자동 재개
                          sessionStorage.setItem('googleLinkPending', '1');
                          window.location.href = url;
                        } catch (e) {
                          console.error('Google Auth Failed:', e);
                          setError('Google 연결 중 오류가 발생했습니다.');
                        }
                      }}
                      className={shared.primaryButton}
                      style={{ width: 'auto', padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                      구글 계정 연결
                    </button>
                  </div>
                )}

                {/* 구글 캘린더 선택 버튼 + 해제/삭제 버튼 (연결된 경우만) */}
                {isConnected && (
                  <>
                    <button
                      onClick={() => void handleGoToSelection()}
                      disabled={loading || syncing}
                      className={`${shared.primaryButton} ${styles.syncButtonMargin}`}
                    >
                      {loading ? (
                        <>
                          <div className={styles.spinner} style={{ borderColor: 'white', borderTopColor: 'transparent' }} />
                          불러오는 중...
                        </>
                      ) : '구글 캘린더 선택'}
                    </button>
                    {/* Google 로그인 유저: 동기화된 캘린더가 있을 때만 "삭제" 버튼 표시 */}
                    {/* Apple 로그인 유저: 항상 "연동 해제 및 캘린더 삭제" 버튼 표시 */}
                    {(!hasGoogleProvider || existingGoogleCalendars.length > 0) && (
                      <button
                        onClick={onDisconnect}
                        disabled={loading || syncing}
                        className={styles.disconnectButton}
                      >
                        🔗 {hasGoogleProvider ? '동기화된 캘린더 삭제' : '연동 해제 및 캘린더 삭제'}
                      </button>
                    )}
                  </>
                )}

                {error && (
                  <div className={styles.errorMessage}>{error}</div>
                )}
              </div>
            )
          ) : (
            /* Selection 단계 */
            <div className={`${styles.section} ${styles.selectionSection}`}>
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

              <button
                onClick={handleSync}
                disabled={syncing || selectedIds.size === 0}
                className={`${shared.primaryButton} ${styles.syncButtonMargin}`}
              >
                {syncing ? '동기화 중...' : `선택한 ${selectedIds.size}개 캘린더 동기화`}
              </button>

              {error && (
                <div className={styles.errorMessage}>{error}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
