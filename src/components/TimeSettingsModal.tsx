import { useState, useEffect } from 'react';
import shared from './SharedModal.module.css';
import styles from './TimeSettingsModal.module.css';
import { WeekOrder } from '../types';

interface TimeSettingsModalProps {
  onClose: () => void;
  initialWeekOrder: WeekOrder;
  initialTimezone: string;
  initialAutoTimezone: boolean;
  onSaved: (data: { weekOrder: WeekOrder; timezone: string; autoTimezone: boolean }) => void;
}

// 주요 시간대 목록
const TIMEZONE_OPTIONS = [
  { value: 'Pacific/Honolulu', label: '(GMT-10:00) 하와이' },
  { value: 'America/Anchorage', label: '(GMT-09:00) 알래스카' },
  { value: 'America/Los_Angeles', label: '(GMT-08:00) 태평양 표준시' },
  { value: 'America/Denver', label: '(GMT-07:00) 산악 표준시' },
  { value: 'America/Chicago', label: '(GMT-06:00) 중부 표준시' },
  { value: 'America/New_York', label: '(GMT-05:00) 동부 표준시' },
  { value: 'America/Sao_Paulo', label: '(GMT-03:00) 브라질리아' },
  { value: 'Atlantic/Reykjavik', label: '(GMT+00:00) 레이캬비크' },
  { value: 'Europe/London', label: '(GMT+00:00) 런던' },
  { value: 'Europe/Paris', label: '(GMT+01:00) 파리' },
  { value: 'Europe/Berlin', label: '(GMT+01:00) 베를린' },
  { value: 'Europe/Moscow', label: '(GMT+03:00) 모스크바' },
  { value: 'Asia/Dubai', label: '(GMT+04:00) 두바이' },
  { value: 'Asia/Kolkata', label: '(GMT+05:30) 인도' },
  { value: 'Asia/Bangkok', label: '(GMT+07:00) 방콕' },
  { value: 'Asia/Singapore', label: '(GMT+08:00) 싱가포르' },
  { value: 'Asia/Shanghai', label: '(GMT+08:00) 중국' },
  { value: 'Asia/Tokyo', label: '(GMT+09:00) 도쿄' },
  { value: 'Asia/Seoul', label: '(GMT+09:00) 서울' },
  { value: 'Australia/Sydney', label: '(GMT+11:00) 시드니' },
  { value: 'Pacific/Auckland', label: '(GMT+13:00) 오클랜드' },
];

export function TimeSettingsModal({
  onClose,
  initialWeekOrder,
  initialTimezone,
  initialAutoTimezone,
  onSaved,
}: TimeSettingsModalProps) {
  const [autoTimezone, setAutoTimezone] = useState(initialAutoTimezone);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [weekOrder, setWeekOrder] = useState<WeekOrder>(initialWeekOrder);
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // 자동 설정 켜면 브라우저 시간대로 복원
  useEffect(() => {
    if (autoTimezone) {
      setTimezone(detectedTimezone);
    }
  }, [autoTimezone, detectedTimezone]);

  const handleSave = () => {
    onSaved({ weekOrder, timezone, autoTimezone });
    onClose();
  };

  return (
    <div className={shared.modalOverlay}>
      <div className={shared.modalBackdrop} onClick={onClose} />

      <div className={shared.modal}>
        {/* Header */}
        <div className={shared.modalHeader}>
          <div className={shared.modalHeaderSpacer} />
          <div className={shared.modalTitle}>시간</div>
          <div className={shared.modalHeaderSpacerEnd}>
            <button onClick={onClose} className={shared.modalCloseButton}>
              <span className={`material-symbols-rounded ${shared.modalCloseIcon}`}>close</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={shared.modalContent}>
          {/* 시간대 설정 */}
          <div className={shared.section}>
            <p className={shared.sectionTitle}>시간대</p>

            <div className={styles.timezoneAutoRow}>
              <span className={styles.timezoneAutoLabel}>자동 설정</span>
              <label className={styles.toggleSwitch}>
                <input
                  type="checkbox"
                  checked={autoTimezone}
                  onChange={() => setAutoTimezone(prev => !prev)}
                />
                <span className={styles.toggleSlider}></span>
              </label>
            </div>

            {autoTimezone && (
              <div className={styles.timezoneDetected}>
                {detectedTimezone}
              </div>
            )}

            {!autoTimezone && (
              <div className={styles.timezoneSelectWrapper}>
                <select
                  className={styles.timezoneSelect}
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {TIMEZONE_OPTIONS.map(tz => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* 주간 시작 요일 */}
          <div className={shared.section}>
            <p className={shared.sectionTitle}>주간 시작 요일</p>
            <div className={styles.weekOrderOptions}>
              <label
                className={`${styles.weekOrderOption} ${weekOrder === 'mon' ? styles.weekOrderOptionSelected : ''}`}
              >
                <input
                  type="radio"
                  name="weekOrder"
                  value="mon"
                  className={styles.weekOrderRadio}
                  checked={weekOrder === 'mon'}
                  onChange={() => setWeekOrder('mon')}
                />
                월 ~ 일
              </label>
              <label
                className={`${styles.weekOrderOption} ${weekOrder === 'sun' ? styles.weekOrderOptionSelected : ''}`}
              >
                <input
                  type="radio"
                  name="weekOrder"
                  value="sun"
                  className={styles.weekOrderRadio}
                  checked={weekOrder === 'sun'}
                  onChange={() => setWeekOrder('sun')}
                />
                일 ~ 토
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className={shared.primaryButton} onClick={handleSave}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
