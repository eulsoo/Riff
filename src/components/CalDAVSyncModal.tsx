import { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, CalDAVConfig, getCalendars, syncSelectedCalendars, waitForSyncIdle } from '../services/caldav';
import { saveCalDAVSyncSettings, getCalDAVSyncSettings, deleteAllCalDAVData, saveCalendarMetadata, normalizeCalendarUrl, CalendarMetadata } from '../services/api';
import { isCalDAVSyncTarget } from '../services/calendarSyncUtils';
import { supabase } from '../lib/supabase';
import styles from './CalDAVSyncModal.module.css';
import shared from './SharedModal.module.css';

interface CalDAVSyncModalProps {
  onClose: () => void;
  onSyncComplete: (count: number, syncedCalendarUrls?: string[]) => void | Promise<void>;
  onDisconnectSuccess?: () => void;
  mode?: 'sync' | 'auth-only';
  existingCalendars: CalendarMetadata[];
  authNoticeMessage?: string;
  onCalDAVAuthSuccess?: () => void;
}

export function CalDAVSyncModal({
  onClose,
  onSyncComplete,
  onDisconnectSuccess,
  mode = 'sync',
  existingCalendars,
  authNoticeMessage,
  onCalDAVAuthSuccess,
}: CalDAVSyncModalProps) {
  const [step, setStep] = useState<'credentials' | 'selection'>('credentials');
  const [serverUrl, setServerUrl] = useState('https://caldav.icloud.com');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [settingId, setSettingId] = useState<string | null>(null);
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false); // caldav_sync_settings.enabled
  const [savePasswordChecked, setSavePasswordChecked] = useState(true);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selectedCalendars, setSelectedCalendars] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingSettings, setExistingSettings] = useState<{
    lastSyncAt?: string | null;
    selectedCalendarUrls?: string[];
    serverUrl?: string;
    username?: string;
  } | null>(null);

  // 연결 여부: 자격증명이 있고 enabled 상태여야 연결됨
  const isConnected = hasSavedPassword && !!settingId && isEnabled;

  // CalDAV 캘린더가 메타데이터에 등록돼 있으면 해제 버튼 표시
  // (자격증명이 없어도 stale 메타데이터가 남아있을 수 있음)
  // type 필드가 null인 오래된 데이터도 포함하기 위해 isCalDAVSyncTarget 사용
  const hasCalDAVCalendars = existingCalendars.some(c => c.type === 'caldav' || isCalDAVSyncTarget(c));

  // Riff 섹션에서 iCloud로 연동된(createdFromApp) 캘린더는 iCloud 선택 목록에서 제외
  const selectableCalendars = useMemo(() => {
    const riffSyncedUrlSet = new Set(
      existingCalendars
        .filter(cal => cal.createdFromApp)
        .map(cal => normalizeCalendarUrl(cal.url))
        .filter(Boolean)
    );

    return calendars.filter(cal => {
      const normalized = normalizeCalendarUrl(cal.url);
      return !normalized || !riffSyncedUrlSet.has(normalized);
    });
  }, [calendars, existingCalendars]);

  // 기존 설정 불러오기
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // 1. DB에서 보안 설정 조회 (우선순위 높음)
        try {
          const { data } = await import('../lib/supabase').then(m => m.supabase.auth.getSession());
          const token = data.session?.access_token;

          if (token) {
            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/caldav-proxy`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ action: 'loadSettings' })
            });

            if (response.ok) {
              const result = await response.json();
              if (result.exists) {
                setServerUrl(result.serverUrl);
                setUsername(result.username);
                setSettingId(result.settingId);
                setHasSavedPassword(result.hasPassword);
                // Edge Function은 enabled 필드를 반환하지 않으므로 DB에서 직접 확인
                const dbSettings = await getCalDAVSyncSettings();
                setIsEnabled(dbSettings?.enabled ?? false);
                return;
              }
            }
          }
        } catch (e) {
          console.error('보안 설정 로드 실패:', e);
        }

        // 2. 로컬 설정 (구형 데이터)
        const settings = await getCalDAVSyncSettings();
        if (settings) {
          setExistingSettings({
            lastSyncAt: settings.lastSyncAt,
            selectedCalendarUrls: settings.selectedCalendarUrls,
            serverUrl: settings.serverUrl,
            username: settings.username,
          });
          setServerUrl(settings.serverUrl);
          setUsername(settings.username);
          setIsEnabled(settings.enabled);
          if (settings.password) {
            setHasSavedPassword(true);
            setSettingId(settings.id);
          }
        }
      } finally {
        // 설정 로드 완료 (자동 스킵 없음 — 항상 credentials 단계부터 시작)
      }
    };
    loadSettings();
  }, []);

  // cloud_sync/cloud_off 모두 항상 계정연결(credentials) 단계부터 시작 — 자동 스킵 없음

  // Step 1: 인증 및 캘린더 목록 가져오기
  const handleFetchCalendars = async () => {
    if (!serverUrl || !username || (!password && !settingId)) {
      setError('서버 정보를 모두 입력해주세요.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const config: CalDAVConfig = {
        serverUrl: serverUrl.trim(),
        username: username.trim(),
        password: password ? password.trim() : undefined,
        settingId: settingId || undefined
      };

      if (!config.password && !config.settingId) {
        setError('앱 별 암호를 입력해주세요.');
        setLoading(false);
        return;
      }

      const rawCalendars = await getCalendars(config);

      const calendarList = rawCalendars.filter(cal => {
        const name = (cal.displayName || '').toLowerCase();
        const excludedKeywords = ['inbox', 'outbox', 'notification', 'reminders'];
        return !excludedKeywords.some(keyword => name.includes(keyword));
      });

      setCalendars(calendarList);

      // 자동 저장 (성공 시)
      if (savePasswordChecked && (password || !settingId)) {
        try {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;

          if (token) {
            const saveRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/caldav-proxy`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ action: 'saveSettings', serverUrl, username, password })
            });
            if (saveRes.ok) {
              const result = await saveRes.json();
              setSettingId(result.settingId);
              setHasSavedPassword(true);
            }
          }
        } catch (e) {
          console.warn('자동 저장 실패', e);
        }
      }

      // 모드에 따른 분기
      if (mode === 'auth-only') {
        onCalDAVAuthSuccess?.();
        onClose();
        return;
      }

      // sync 모드이면 다음 단계로(선택 화면)
      setStep('selection');

      // 기존 설정이 있다면 이전에 선택했던 캘린더들을 자동으로 체크
      const preSelected = new Set<string>();
      const riffSyncedUrlSet = new Set(
        existingCalendars
          .filter(cal => cal.createdFromApp)
          .map(cal => normalizeCalendarUrl(cal.url))
          .filter(Boolean)
      );
      const selectableCalendarList = calendarList.filter(cal => {
        const normalized = normalizeCalendarUrl(cal.url);
        return !normalized || !riffSyncedUrlSet.has(normalized);
      });

      const activeNormalizedUrls = new Set(existingCalendars.map(c => normalizeCalendarUrl(c.url)));
      const settingSelectedUrls = new Set(
        (existingSettings?.selectedCalendarUrls || []).map(u => normalizeCalendarUrl(u))
      );

      selectableCalendarList.forEach(cal => {
        const normUrl = normalizeCalendarUrl(cal.url);
        if (normUrl && (activeNormalizedUrls.has(normUrl) || settingSelectedUrls.has(normUrl))) {
          preSelected.add(cal.url);
        }
      });

      setSelectedCalendars(preSelected);

    } catch (err: any) {
      console.error('CalDAV 모달 오류:', err);
      const errorMsg = err?.message || '캘린더 목록을 가져올 수 없습니다.';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // 캘린더 선택/해제
  const toggleCalendar = (calendarUrl: string) => {
    const newSelected = new Set(selectedCalendars);
    if (newSelected.has(calendarUrl)) {
      newSelected.delete(calendarUrl);
    } else {
      newSelected.add(calendarUrl);
    }
    setSelectedCalendars(newSelected);
  };

  // 전체 선택/해제
  const toggleAllCalendars = () => {
    if (selectedCalendars.size === selectableCalendars.length) {
      setSelectedCalendars(new Set());
    } else {
      setSelectedCalendars(new Set(selectableCalendars.map(cal => cal.url)));
    }
  };

  // 선택한 캘린더 동기화 및 설정 저장
  const handleSync = async () => {
    if (selectedCalendars.size === 0) {
      void handleSwitchDisconnect();
      return;
    }

    setSyncing(true);
    setError(null);
    try {
      const config: CalDAVConfig = { serverUrl, username, password: password || undefined, settingId: settingId || undefined };

      const newCalDAVMetadata = selectableCalendars
        .filter(cal => selectedCalendars.has(cal.url))
        .map(cal => ({
          url: cal.url,
          displayName: cal.displayName,
          color: cal.color || '#3b82f6',
          isShared: cal.isShared,
          isSubscription: cal.isSubscription,
          readOnly: cal.readOnly
        }));

      const existingSubscriptionCals = existingCalendars.filter(cal =>
        cal.type === 'subscription' ||
        cal.isSubscription === true ||
        (cal.url.startsWith('http') && cal.url.endsWith('.ics'))
      );

      const metadataToSave = [
        ...newCalDAVMetadata,
        ...existingSubscriptionCals.filter(sub =>
          !newCalDAVMetadata.some(m => m.url === sub.url)
        )
      ];
      saveCalendarMetadata(metadataToSave);

      const lastSyncAt = existingSettings &&
        existingSettings.lastSyncAt &&
        serverUrl === existingSettings.serverUrl &&
        username === existingSettings.username
        ? existingSettings.lastSyncAt
        : null;

      const fullStart = new Date();
      fullStart.setMonth(fullStart.getMonth() - 6);
      const fullEnd = new Date();
      fullEnd.setMonth(fullEnd.getMonth() + 6);
      const selectedUrls = Array.from(selectedCalendars);
      const syncRange = { startDate: fullStart, endDate: fullEnd };
      const runSyncOnce = () =>
        syncSelectedCalendars(
          config,
          selectedUrls,
          {
            lastSyncAt,
            forceFullSync: true,
            manualRange: syncRange,
            onProgress: (cur, tot) => setSyncProgress({ current: cur, total: tot })
          }
        );

      setSyncProgress({ current: 0, total: selectedCalendars.size });
      let count = await runSyncOnce();
      if (count === 0) {
        await waitForSyncIdle();
        count = await runSyncOnce();
      }
      setSyncProgress(null);

      await saveCalDAVSyncSettings({
        serverUrl,
        username,
        password,
        selectedCalendarUrls: selectedUrls,
        syncIntervalMinutes: 60,
      });

      await onSyncComplete(count, selectedUrls);
      onClose();
    } catch (err: any) {
      setError(err.message || '동기화 중 오류가 발생했습니다.');
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  // 스위치 OFF: 연동 해제 (confirm 없이, reload 없이)
  const handleSwitchDisconnect = async () => {
    setSyncing(true);
    setError(null);
    try {
      const success = await deleteAllCalDAVData();
      if (success) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('caldavAuthError');
          localStorage.removeItem('caldavCalendarMetadata');
          Object.keys(window.localStorage)
            .filter(key => key.startsWith('caldavSyncTokens'))
            .forEach(key => window.localStorage.removeItem(key));
        }
        onDisconnectSuccess?.();
        onClose();
      } else {
        throw new Error('데이터 삭제 중 오류가 발생했습니다.');
      }
    } catch (err: any) {
      console.error('Disconnect error:', err);
      setError(err.message || '연동 해제 실패');
    } finally {
      setSyncing(false);
    }
  };

  // Unmount 시 포커스 해제 (Autofill 팝업 잔상 제거)
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return () => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    };
  }, []);

  return (
    <div id="caldav-sync-modal-container" className={shared.modalOverlay} ref={containerRef}>
      <div className={shared.modalBackdrop} onClick={onClose} />
      <div className={shared.modal}>
        <div className={shared.modalHeader}>
          <div className={shared.modalHeaderSpacer}>
            {step === 'selection' && (
              <button onClick={() => setStep('credentials')} className={shared.backButton} aria-label="뒤로">
                <span className={`material-symbols-rounded ${shared.backIcon}`}>arrow_back_ios</span>
              </button>
            )}
          </div>
          <div className={shared.modalTitle}>
            {step === 'credentials' ? '계정연결' : '캘린더 선택'}
          </div>
          <div className={shared.modalHeaderSpacerEnd}>
            <button onClick={onClose} className={shared.modalCloseButton}>
              <span className={`material-symbols-rounded ${shared.modalCloseIcon}`}>close</span>
            </button>
          </div>
        </div>

        <div className={shared.modalContent}>
          {step === 'credentials' && authNoticeMessage && (
            <div className={styles.errorMessage} style={{ marginBottom: '0.75rem' }}>
              {authNoticeMessage}
            </div>
          )}

          {step === 'credentials' ? (
            /* Step 1: Credentials Form */
            <form
              className={`${styles.section} ${styles.credentialsForm}`}
              onSubmit={(e) => {
                e.preventDefault();
                handleFetchCalendars();
              }}
              autoComplete="off"
            >
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>서버 URL</label>
                <input
                  type="text"
                  placeholder="https://caldav.icloud.com"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  className={styles.formInput}
                  disabled={loading || syncing}
                  autoComplete="url"
                  name="caldav-url"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>사용자명</label>
                <input
                  type="text"
                  placeholder="iCloud 이메일 주소"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={styles.formInput}
                  disabled={loading || syncing}
                  autoComplete="username"
                  name="caldav-username"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>암호</label>
                {hasSavedPassword ? (
                  <div className={styles.savedPasswordContainer}>
                    <div className={styles.savedPasswordBox}>
                      🔒 안전하게 저장된 암호 사용 중
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setHasSavedPassword(false);
                        setSettingId(null);
                        setPassword('');
                      }}
                      className={styles.resetButton}
                    >
                      재설정
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="password"
                      placeholder="앱 전용 비밀번호 (예: xxxx-xxxx-xxxx-xxxx)"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={styles.formInput}
                      disabled={loading || syncing}
                      autoComplete="new-password"
                      name="caldav-password"
                    />
                    <div className={styles.checkboxWrapper}>
                      <input
                        type="checkbox"
                        id="savePassword"
                        checked={savePasswordChecked}
                        onChange={(e) => setSavePasswordChecked(e.target.checked)}
                        className={styles.checkboxInput}
                      />
                      <label htmlFor="savePassword" className={styles.checkboxLabel}>
                        🔒 이 암호를 안전하게 저장하기 (다음부터 입력 생략)
                      </label>
                    </div>
                  </>
                )}
                <p className={styles.helpText}>
                  ※ <strong>앱 전용 비밀번호</strong>를 입력해주세요. (Apple ID 암호 아님)<br />
                  설정 → Apple ID → 로그인 및 보안 → 앱 수준 암호에서 생성
                </p>
                {!hasSavedPassword && (
                  <a
                    href="/guides/icloud-app-password.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.guideLink}
                  >
                    앱 비밀번호 발급 방법 보기
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={handleFetchCalendars}
                disabled={loading || syncing}
                className={shared.primaryButton}
              >
                {loading && <div className={styles.spinner} />}
                {loading ? '확인 중...' : 'iCloud 캘린더 연결'}
              </button>

              {(isConnected || hasCalDAVCalendars) && (
                <button
                  type="button"
                  onClick={() => void handleSwitchDisconnect()}
                  disabled={loading || syncing}
                  className={styles.disconnectButton}
                >
                  🔗 연동 해제 및 캘린더 삭제
                </button>
              )}
            </form>
          ) : (
            /* Step 2: Selection Form */
            <div className={`${styles.section} ${styles.selectionSection}`}>
              <div className={styles.selectAllRow}>
                <label className={styles.selectAllLabel}>
                  <input
                    type="checkbox"
                    checked={selectedCalendars.size === selectableCalendars.length && selectableCalendars.length > 0}
                    onChange={toggleAllCalendars}
                    disabled={syncing}
                    className={styles.checkboxInput}
                  />
                  <span>전체 선택</span>
                </label>
              </div>
              <div className={styles.calendarList}>
                {selectableCalendars.map((calendar) => (
                  <label key={calendar.url} className={styles.calendarItem}>
                    <input
                      type="checkbox"
                      checked={selectedCalendars.has(calendar.url)}
                      onChange={() => toggleCalendar(calendar.url)}
                      disabled={syncing}
                      style={{ '--cal-color': calendar.color || '#3b82f6' } as React.CSSProperties}
                    />
                    <span>{calendar.displayName}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={handleSync}
                disabled={syncing || selectedCalendars.size === 0}
                className={`${shared.primaryButton} ${styles.syncButtonMargin}`}
              >
                {syncing
                  ? (syncProgress && syncProgress.total > 0 ? `동기화 중... ${Math.round((syncProgress.current / syncProgress.total) * 100)}%` : '동기화 중...')
                  : `선택한 ${selectedCalendars.size}개 캘린더 동기화`}
              </button>
            </div>
          )}

          {error && (
            <div className={styles.errorMessage}>
              {error}
              {error.includes('CORS') && (
                <div className={styles.corsMessage}>
                  💡 브라우저 보안 제한으로 CalDAV 직접 연결이 불가능합니다.
                  ICS 파일 import 기능을 사용해주세요.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
