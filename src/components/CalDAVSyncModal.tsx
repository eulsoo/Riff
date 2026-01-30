import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Calendar, CalDAVConfig, getCalendars, syncSelectedCalendars } from '../services/caldav';
import { saveCalDAVSyncSettings, getCalDAVSyncSettings, deleteAllCalDAVData, saveCalendarMetadata } from '../services/api';
import { supabase } from '../lib/supabase';
import styles from './CalDAVSyncModal.module.css';

interface CalDAVSyncModalProps {
  onClose: () => void;
  onSyncComplete: (count: number) => void;
}

export function CalDAVSyncModal({ onClose, onSyncComplete }: CalDAVSyncModalProps) {
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
              // DB 설정이 있으면 로컬 설정 무시하고 리턴
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

  const handleSaveSettings = async () => {
    if (!serverUrl || !username || !password) {
      setError('저장할 정보를 모두 입력해주세요.');
      return;
    }

    try {
      setLoading(true);
      const { data } = await import('../lib/supabase').then(m => m.supabase.auth.getSession());
      const token = data.session?.access_token;
      if (!token) {
        setError('로그인이 필요합니다.');
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/caldav-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'saveSettings',
          serverUrl,
          username,
          password
        })
      });

      if (!response.ok) throw new Error('저장 실패');

      const result = await response.json();
      setSettingId(result.settingId);
      setHasSavedPassword(true);
      setPassword(''); // 저장 후 비번 클리어 (보안상)
      if (typeof window !== 'undefined') window.alert('설정이 안전하게 저장되었습니다.');
    } catch (e) {
      console.error(e);
      setError('설정 저장 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 캘린더 목록 가져오기
  const handleFetchCalendars = async () => {
    // 저장된 설정(settingId)이 없고 비밀번호도 입력 안 했으면 에러
    if (!serverUrl || !username || (!password && !settingId)) {
      setError('서버 정보를 모두 입력해주세요.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // useSavedSettings 체크가 되어 있으면 settingId 사용, 아니면 password 필수
      const config: CalDAVConfig = {
        serverUrl: serverUrl.trim(),
        username: username.trim(),
        password: password ? password.trim() : undefined,
        settingId: settingId || undefined
      };

      // 비밀번호 검증
      if (!config.password && !config.settingId) {
        setError('앱 별 암호를 입력해주세요.');
        setLoading(false);
        return;
      }

      const calendarList = await getCalendars(config);
      console.log('Fetched Calendars Objects:', calendarList);
      setCalendars(calendarList);

      // 성공했고, 저장이 체크되어 있고, 아직 저장된 상태(settingId)가 아니라면 자동 저장
      // 성공했고, 저장이 체크되어 있고, (아직 저장 안됨 OR 비밀번호가 새로 입력됨)
      if (savePasswordChecked && (password || !settingId)) {
        try {
          // 조용히 백그라운드 저장 -> 사용자 피드백 추가
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;

          if (token) {
            // settingId가 있어도 업데이트를 위해 보냄 (Upsert 로직 필요하거나 action='saveSettings'가 덮어쓰기 지원해야 함)
            // 현재 Edge Function의 'saveSettings'는 upsert를 사용하므로 덮어쓰기 됨
            const saveRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/caldav-proxy`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ action: 'saveSettings', serverUrl, username, password })
            });
            if (saveRes.ok) {
              const result = await saveRes.json();
              setSettingId(result.settingId);
              setHasSavedPassword(true);
              if (typeof window !== 'undefined') {
                window.alert('연결 정보가 안전하게 저장되었습니다.\n다음부터는 암호 입력 없이 사용하실 수 있습니다.');
              }
            } else {
              console.warn('설정 저장 실패', await saveRes.text());
              // 실패해도 목록은 가져왔으니 에러를 띄우진 않음 (콘솔만)
            }
          }
        } catch (e) {
          console.warn('자동 저장 실패', e);
        }
      }



      // 기존 설정이 있다면 이전에 선택했던 캘린더들을 자동으로 체크
      const preSelected = new Set<string>();
      if (existingSettings?.selectedCalendarUrls) {
        // 새로 가져온 목록에 존재하는 캘린더만 체크 (삭제된 캘린더 제외)
        const currentUrls = new Set(calendarList.map(c => c.url));
        existingSettings.selectedCalendarUrls.forEach(url => {
          if (currentUrls.has(url)) {
            preSelected.add(url);
          }
        });
      }
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

      // 선택된 캘린더들의 메타데이터 저장
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

      // 기존 설정이 있고, 서버 정보가 같으면 마지막 동기화 시점부터 가져오기
      // 서버 정보가 다르거나 첫 동기화면 null 전달
      const lastSyncAt = existingSettings &&
        existingSettings.lastSyncAt &&
        serverUrl === existingSettings.serverUrl &&
        username === existingSettings.username
        ? existingSettings.lastSyncAt
        : null;

      if (lastSyncAt) {
        console.log(`마지막 동기화 시점(${lastSyncAt})부터 동기화합니다.`);
      } else {
        console.log('첫 동기화 또는 새로운 서버 정보: 최근 1년간의 일정을 가져옵니다.');
      }

      // 동기화 실행
      const count = await syncSelectedCalendars(
        config,
        Array.from(selectedCalendars),
        lastSyncAt
      );

      // 동기화 설정 저장 (자동 동기화 활성화)
      const saved = await saveCalDAVSyncSettings({
        serverUrl,
        username,
        password,
        selectedCalendarUrls: Array.from(selectedCalendars),
        syncIntervalMinutes: 60, // 기본 1시간마다
      });

      if (!saved) {
        console.warn('동기화 설정 저장 실패');
      }

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
        // 동기화 토큰 로컬 스토리지 삭제
        if (typeof window !== 'undefined') {
          Object.keys(window.localStorage)
            .filter(key => key.startsWith('caldavSyncTokens'))
            .forEach(key => window.localStorage.removeItem(key));
        }

        alert('연동이 해제되고 데이터가 삭제되었습니다.');
        window.location.reload(); // 깔끔한 상태 반영을 위해 새로고침
      } else {
        throw new Error('데이터 삭제 중 오류가 발생했습니다.');
      }
    } catch (err: any) {
      console.error('Disconnect error:', err);
      setError(err.message || '연동 해제 실패');
      setSyncing(false);
    }
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBackdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>캘린더 동기화</h2>
          <button onClick={onClose} className={styles.modalCloseButton}>
            <X className={styles.modalCloseIcon} />
          </button>
        </div>

        <div className={styles.modalContent}>
          {/* 서버 정보 입력 */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>서버 정보</h3>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>서버 URL</label>
              <input
                type="text"
                placeholder="https://caldav.icloud.com"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                className={styles.formInput}
                disabled={loading || syncing}
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
                    onClick={() => {
                      if (window.confirm('저장된 암호를 삭제하고 새로 입력하시겠습니까?')) {
                        setHasSavedPassword(false);
                        setSettingId(null);
                        setPassword('');
                      }
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
            >
              {loading ? '가져오는 중...' : '캘린더 목록 가져오기'}
            </button>
          </div>

          {/* 캘린더 선택 */}
          {calendars.length > 0 && (
            <div className={styles.section}>
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
              <div className={styles.calendarList}>
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

          {existingSettings && (
            <button
              onClick={handleDisconnect}
              disabled={loading || syncing}
              className={styles.disconnectButton}
            >
              연동 해제 및 데이터 삭제
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
