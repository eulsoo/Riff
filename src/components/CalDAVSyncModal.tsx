import { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, CalDAVConfig, getCalendars, syncSelectedCalendars, waitForSyncIdle } from '../services/caldav';
import { saveCalDAVSyncSettings, getCalDAVSyncSettings, deleteAllCalDAVData, saveCalendarMetadata, normalizeCalendarUrl, CalendarMetadata } from '../services/api';
import { supabase } from '../lib/supabase';
import styles from './CalDAVSyncModal.module.css';
import shared from './SharedModal.module.css';

interface CalDAVSyncModalProps {
  onClose: () => void;
  onSyncComplete: (count: number, syncedCalendarUrls?: string[]) => void | Promise<void>;
  mode?: 'sync' | 'auth-only';
  existingCalendars: CalendarMetadata[];
  authNoticeMessage?: string;
  onCalDAVAuthSuccess?: () => void;
}

export function CalDAVSyncModal({
  onClose,
  onSyncComplete,
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
  const autoFetchedRef = useRef(false);

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
      }
    };
    loadSettings();
  }, []);

  // sync 모드 + 저장된 자격증명이 있으면 credentials 단계를 건너뛰고 바로 캘린더 목록 fetch
  useEffect(() => {
    if (
      mode === 'sync' &&
      hasSavedPassword &&
      settingId &&
      step === 'credentials' &&
      !autoFetchedRef.current
    ) {
      autoFetchedRef.current = true;
      handleFetchCalendars();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSavedPassword, settingId]);

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

      // Filter out system calendars (inbox, outbox, notification) and reminders
      // These are not typically shown in the main calendar view
      const calendarList = rawCalendars.filter(cal => {
        const name = (cal.displayName || '').toLowerCase();
        // Check for specific system names. 'reminders' is Apple's Reminders app list.
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
              // 설정 저장 완료
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

      // 1. 현재 앱에 이미 등록된 캘린더 (동기화 중)
      const activeNormalizedUrls = new Set(existingCalendars.map(c => normalizeCalendarUrl(c.url)));

      // 2. 저장된 설정의 선택된 URL
      const settingSelectedUrls = new Set(
        (existingSettings?.selectedCalendarUrls || []).map(u => normalizeCalendarUrl(u))
      );

      selectableCalendarList.forEach(cal => {
        const normUrl = normalizeCalendarUrl(cal.url);
        // 이미 앱에 있거나, 설정에 저장되어 있다면 체크
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
      setError('동기화할 캘린더를 선택해주세요.');
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

      // 기존 구독 캘린더 메타데이터를 보존하면서 CalDAV 캘린더 업데이트
      // iCloud 동기화가 구독 캘린더를 덮어쓰지 않도록 구독 캘린더를 분리하여 유지
      const existingSubscriptionCals = existingCalendars.filter(cal =>
        cal.type === 'subscription' ||
        cal.isSubscription === true ||
        (cal.url.startsWith('http') && cal.url.endsWith('.ics'))
      );

      // 구독 캘린더를 새 CalDAV 목록에 합쳐서 저장 (중복 URL 방지)
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

      // 모달 동기화 시 넓은 범위 + forceFullSync (재연결/재동기화 시 delta sync가 빈 결과를 주는 것 방지)
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
            forceFullSync: true, // sync token 무시하고 전체 fetch → 재동기화 직후 일정 즉시 표시
            manualRange: syncRange,
            onProgress: (cur, tot) => setSyncProgress({ current: cur, total: tot })
          }
        );

      setSyncProgress({ current: 0, total: selectedCalendars.size });
      let count = await runSyncOnce();
      // syncInFlight로 차단됐으면 백그라운드 sync 완료까지 대기 후 재시도
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

      // 실제로 동기화된(선택된) 캘린더 URL 전달 (재동기화 시 exclude 목록에서 제거용)
      // loadData 완료 후 모달 닫기 → 일정이 화면에 표시된 뒤 닫힘
      await onSyncComplete(count, selectedUrls);
      onClose();
    } catch (err: any) {
      setError(err.message || '동기화 중 오류가 발생했습니다.');
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('정말로 연동을 해제하고 모든 외부 캘린더 일정을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) {
      return;
    }

    setSyncing(true);
    try {
      const success = await deleteAllCalDAVData();
      if (success) {
        if (typeof window !== 'undefined') {
          Object.keys(window.localStorage)
            .filter(key => key.startsWith('caldavSyncTokens'))
            .forEach(key => window.localStorage.removeItem(key));
        }

        alert('연동이 해제되고 데이터가 삭제되었습니다.');
        window.location.reload();
      } else {
        throw new Error('데이터 삭제 중 오류가 발생했습니다.');
      }
    } catch (err: any) {
      console.error('Disconnect error:', err);
      setError(err.message || '연동 해제 실패');
      setSyncing(false);
    }
  };

  // Unmount 시 포커스 해제 (Autofill 팝업 잔상 제거)
  useEffect(() => {
    return () => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    };
  }, []);

  return (
    <div id="caldav-sync-modal-container" className={shared.modalOverlay}>
      <div className={shared.modalBackdrop} onClick={onClose} />
      <div className={shared.modal}>
        <div className={shared.modalHeader}>
          <div className={shared.modalHeaderSpacer}>
            {step === 'selection' && !autoFetchedRef.current && (
              <button onClick={() => setStep('credentials')} className={shared.backButton} aria-label="뒤로">
                <span className={`material-symbols-rounded ${shared.backIcon}`}>arrow_back_ios</span>
              </button>
            )}
          </div>
          <div className={shared.modalTitle}>
            {step === 'credentials' ? '계정정보 입력' : '캘린더 선택'}
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
          {step === 'credentials' && mode === 'sync' && loading && hasSavedPassword ? (
            /* 저장된 자격증명으로 자동 연결 중 */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '40px 0', color: '#6b7280' }}>
              <div className={styles.spinner} />
              <span style={{ fontSize: '0.9rem' }}>캘린더 목록 불러오는 중...</span>
            </div>
          ) : step === 'credentials' ? (
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
                onClick={handleFetchCalendars}
                disabled={loading || syncing}
                className={shared.primaryButton}
              >
                {loading && (
                  <div className={styles.spinner}></div>
                )}
                {loading ? '확인 중...' : '확인'}
              </button>


              {existingSettings && (
                <button
                  onClick={handleDisconnect}
                  disabled={loading || syncing}
                  className={shared.primaryButton}
                >
                  연동 해제 및 데이터 삭제
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
