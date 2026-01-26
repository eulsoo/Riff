import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Calendar, CalDAVConfig, getCalendars, syncSelectedCalendars } from '../services/caldav';
import { saveCalDAVSyncSettings, getCalDAVSyncSettings, deleteAllCalDAVData, saveCalendarMetadata } from '../services/api';
import styles from './CalDAVSyncModal.module.css';

interface CalDAVSyncModalProps {
  onClose: () => void;
  onSyncComplete: (count: number) => void;
}

export function CalDAVSyncModal({ onClose, onSyncComplete }: CalDAVSyncModalProps) {
  const [serverUrl, setServerUrl] = useState('https://caldav.icloud.com');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
    const loadExistingSettings = async () => {
      const settings = await getCalDAVSyncSettings();
      if (settings) {
        setExistingSettings({
          lastSyncAt: settings.lastSyncAt,
          selectedCalendarUrls: settings.selectedCalendarUrls,
          serverUrl: settings.serverUrl,
          username: settings.username,
        });
        // 기존 설정이 있으면 서버 정보도 채우기
        setServerUrl(settings.serverUrl);
        setUsername(settings.username);
        // 비밀번호는 보안상 채우지 않음
      }
    };
    loadExistingSettings();
  }, []);

  // 캘린더 목록 가져오기
  const handleFetchCalendars = async () => {
    if (!serverUrl || !username || !password) {
      setError('서버 정보를 모두 입력해주세요.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const config: CalDAVConfig = { serverUrl, username, password };
      const calendarList = await getCalendars(config);
      setCalendars(calendarList);
      setSelectedCalendars(new Set()); // 초기화
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
      const config: CalDAVConfig = { serverUrl, username, password };

      // 선택된 캘린더들의 메타데이터 저장
      const metadataToSave = calendars
        .filter(cal => selectedCalendars.has(cal.url))
        .map(cal => ({
          url: cal.url,
          displayName: cal.displayName,
          color: cal.color || '#3b82f6'
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
              <label className={styles.formLabel}>비밀번호</label>
              <input
                type="password"
                placeholder="앱 전용 비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={styles.formInput}
                disabled={loading || syncing}
              />
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
