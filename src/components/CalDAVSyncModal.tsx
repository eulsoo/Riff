import { useState, useEffect } from 'react';
import { Calendar, CalDAVConfig, getCalendars, syncSelectedCalendars } from '../services/caldav';
import { saveCalDAVSyncSettings, getCalDAVSyncSettings, deleteAllCalDAVData, saveCalendarMetadata, deleteCalDAVSyncSettings, normalizeCalendarUrl, CalendarMetadata } from '../services/api';
import { supabase } from '../lib/supabase';
import styles from './CalDAVSyncModal.module.css';

interface CalDAVSyncModalProps {
  onClose: () => void;
  onSyncComplete: (count: number) => void;
  mode?: 'sync' | 'auth-only';
  existingCalendars: CalendarMetadata[];
}

export function CalDAVSyncModal({ onClose, onSyncComplete, mode = 'sync', existingCalendars }: CalDAVSyncModalProps) {
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
  const [error, setError] = useState<string | null>(null);
  const [existingSettings, setExistingSettings] = useState<{
    lastSyncAt?: string | null;
    selectedCalendarUrls?: string[];
    serverUrl?: string;
    username?: string;
  } | null>(null);

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

      const calendarList = await getCalendars(config);
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
        // 인증(및 저장) 확인 완료 -> 닫기
        if (typeof window !== 'undefined') {
          // 사용자 피드백 없이 닫으면 사용자가 혼란스러울 수 있으나, MainLayout의 흐름에 맡김
          // 혹은 Toast를 여기서 띄우는 방법도 있음.
          window.alert('설정이 저장되었습니다.');
        }
        onClose();
        return;
      }

      // sync 모드이면 다음 단계로(선택 화면)
      setStep('selection');

      // 기존 설정이 있다면 이전에 선택했던 캘린더들을 자동으로 체크
      const preSelected = new Set<string>();

      // 1. 현재 앱에 이미 등록된 캘린더 (동기화 중)
      const activeNormalizedUrls = new Set(existingCalendars.map(c => normalizeCalendarUrl(c.url)));

      // 2. 저장된 설정의 선택된 URL
      const settingSelectedUrls = new Set(
        (existingSettings?.selectedCalendarUrls || []).map(u => normalizeCalendarUrl(u))
      );

      calendarList.forEach(cal => {
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
    if (selectedCalendars.size === calendars.length) {
      setSelectedCalendars(new Set());
    } else {
      setSelectedCalendars(new Set(calendars.map(cal => cal.url)));
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

      const metadataToSave = calendars
        .filter(cal => selectedCalendars.has(cal.url))
        .map(cal => ({
          url: cal.url,
          displayName: cal.displayName,
          color: cal.color || '#3b82f6',
          isShared: cal.isShared,
          isSubscription: cal.isSubscription,
          readOnly: cal.readOnly
        }));
      saveCalendarMetadata(metadataToSave);

      const lastSyncAt = existingSettings &&
        existingSettings.lastSyncAt &&
        serverUrl === existingSettings.serverUrl &&
        username === existingSettings.username
        ? existingSettings.lastSyncAt
        : null;

      const count = await syncSelectedCalendars(
        config,
        Array.from(selectedCalendars),
        lastSyncAt
      );

      await saveCalDAVSyncSettings({
        serverUrl,
        username,
        password,
        selectedCalendarUrls: Array.from(selectedCalendars),
        syncIntervalMinutes: 60,
      });

      onSyncComplete(count);
      onClose();
    } catch (err: any) {
      setError(err.message || '동기화 중 오류가 발생했습니다.');
    } finally {
      setSyncing(false);
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
    <div className={styles.modalOverlay}>
      <div className={styles.modalBackdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          {step === 'selection' && (
            <button onClick={() => setStep('credentials')} className={styles.backButton} aria-label="뒤로">
              <span className={`material-symbols-rounded ${styles.backIcon}`}>chevron_left</span>
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className={styles.modalCloseButton}>
            <span className={`material-symbols-rounded ${styles.modalCloseIcon}`}>close</span>
          </button>
        </div>

        <div className={styles.modalContent}>
          {step === 'credentials' ? (
            /* Step 1: Credentials Form */
            <form
              className={styles.section}
              style={{ paddingTop: '0.5rem' }}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flex: 1, padding: '8px', background: '#f5f5f5', borderRadius: '4px', color: '#666', fontSize: '14px', border: '1px solid #ddd' }}>
                      🔒 안전하게 저장된 암호 사용 중
                    </div>
                    <button
                      onClick={async () => {
                        // DB 설정 즉시 삭제
                        try {
                          await deleteCalDAVSyncSettings();
                        } catch (e) {
                          console.error('설정 삭제 중 오류 (무시됨):', e);
                        }
                        // 상태 초기화
                        setHasSavedPassword(false);
                        setSettingId(null);
                        setPassword('');
                      }}
                      style={{ padding: '8px 12px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '4px', background: 'white', cursor: 'pointer' }}
                    >
                      재설정
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="password"
                      placeholder="앱 전용 비밀번호"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={styles.formInput}
                      disabled={loading || syncing}
                      autoComplete="new-password"
                      name="caldav-password"
                    />
                    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        id="savePassword"
                        checked={savePasswordChecked}
                        onChange={(e) => setSavePasswordChecked(e.target.checked)}
                        style={{ marginRight: '6px' }}
                      />
                      <label htmlFor="savePassword" style={{ fontSize: '13px', color: '#444', cursor: 'pointer' }}>
                        🔒 이 암호를 안전하게 저장하기 (다음부터 입력 생략)
                      </label>
                    </div>
                  </>
                )}
                <p className={styles.helpText}>
                  iCloud 사용 시: 설정 → Apple ID → 앱 비밀번호에서 생성
                </p>
              </div>
              <button
                onClick={handleFetchCalendars}
                disabled={loading || syncing}
                className={styles.fetchButton}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                {loading && (
                  <div style={{ width: 16, height: 16, border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                )}
                {loading ? '확인 중...' : '확인'}
              </button>
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>

              {existingSettings && (
                <button
                  onClick={handleDisconnect}
                  disabled={loading || syncing}
                  className={styles.disconnectButton}
                >
                  연동 해제 및 데이터 삭제
                </button>
              )}
            </form>
          ) : (
            /* Step 2: Selection Form */
            <div className={styles.section} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>동기화할 캘린더 선택</h3>
                <button
                  onClick={toggleAllCalendars}
                  className={styles.selectAllButton}
                  disabled={syncing}
                >
                  {selectedCalendars.size === calendars.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <div className={styles.calendarList} style={{ maxHeight: 'none', flex: 1, minHeight: '200px' }}>
                {calendars.map((calendar) => (
                  <label key={calendar.url} className={styles.calendarItem}>
                    <input
                      type="checkbox"
                      checked={selectedCalendars.has(calendar.url)}
                      onChange={() => toggleCalendar(calendar.url)}
                      disabled={syncing}
                    />
                    <div className={styles.colorChip} style={{ backgroundColor: calendar.color || '#cccccc' }} />
                    <span>{calendar.displayName}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={handleSync}
                disabled={syncing || selectedCalendars.size === 0}
                className={styles.syncButton}
                style={{ marginTop: '1rem' }}
              >
                {syncing
                  ? '동기화 중...'
                  : `선택한 ${selectedCalendars.size}개 캘린더 동기화`}
              </button>
            </div>
          )}

          {error && (
            <div className={styles.errorMessage}>
              {error}
              {error.includes('CORS') && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
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
