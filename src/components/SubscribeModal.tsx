import React, { useState } from 'react';
import styles from './SharedModal.module.css';
import { CalendarMetadata, normalizeCalendarUrl, saveCalendarMetadata, saveLocalCalendarMetadata, upsertEvent } from '../services/api';
import { fetchAndParseICS } from '../services/icsParser';

interface SubscribeModalProps {
  onClose: () => void;
  onSubscribeSuccess: (message: string) => void;
  calendarMetadata: CalendarMetadata[];
  setCalendarMetadata: (metadata: CalendarMetadata[]) => void;
  setVisibleCalendarUrlSet: (updateFn: (prev: Set<string>) => Set<string>) => void;
}

export const SubscribeModal: React.FC<SubscribeModalProps> = ({
  onClose,
  onSubscribeSuccess,
  calendarMetadata,
  setCalendarMetadata,
  setVisibleCalendarUrlSet
}) => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError('URL을 입력해주세요.');
      return;
    }

    // basic url validation
    let validUrl = url.trim();
    if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
      validUrl = 'https://' + validUrl;
    }

    // Check if URL is a well-known non-ICS link (Google Calendar web sharing link)
    if (validUrl.includes('calendar.google.com/calendar/u/') && validUrl.includes('?cid=')) {
      setError('이 주소는 구글 캘린더의 웹 공유 링크입니다.\n\n구글 캘린더 설정 → 캘린더 설정 → 아래쪽의 "iCal 형식의 공개/비공개 주소"를 복사해서 입력해주세요.');
      return;
    }

    setLoading(true);

    try {
      // 1. Fetch to validate and get events
      const now = new Date();
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const end = new Date(now.getFullYear() + 2, 11, 31);

      const { events, calendarName } = await fetchAndParseICS(validUrl, start, end);

      // Check if calendar returned 0 events
      if (events.length === 0) {
        // Google public URL specific guidance
        if (validUrl.includes('calendar.google.com') && validUrl.includes('/public/')) {
          setError('이벤트를 가져올 수 없습니다.\n\n구글 캘린더의 "공개 사용 설정"이 꺼져 있을 수 있습니다.\n"iCal 형식의 비공개 주소"를 사용하면 공개 설정 없이도 구독할 수 있습니다.');
          setLoading(false);
          return;
        }
        // Non-Google: allow subscription even with 0 events (calendar might just be empty)
      }

      // 2. Add to metadata
      const normalizedUrl = normalizeCalendarUrl(validUrl) || validUrl;

      // Check if already subscribed
      const alreadyExists = calendarMetadata.some(c => normalizeCalendarUrl(c.url) === normalizedUrl);
      if (alreadyExists) {
        setError('이미 구독 중인 캘린더입니다.');
        setLoading(false);
        return;
      }

      const newCal: CalendarMetadata = {
        url: validUrl,
        displayName: calendarName || '구독 캘린더',
        color: '#8b5cf6', // Default purple for subscriptions
        isVisible: true,
        isLocal: false,
        type: 'subscription',
        subscriptionUrl: validUrl
      };

      const updatedMetadata = [...calendarMetadata, newCal];
      setCalendarMetadata(updatedMetadata);
      saveCalendarMetadata(updatedMetadata);
      saveLocalCalendarMetadata(updatedMetadata); // Save to local as well

      setVisibleCalendarUrlSet(prev => {
        const next = new Set(prev);
        next.add(normalizedUrl);
        return next;
      });

      // 3. Upsert events
      if (events.length > 0) {
        await Promise.all(
          events.map(ev =>
            upsertEvent({
              ...ev,
              calendarUrl: normalizedUrl,
              source: 'caldav'
            })
          )
        );
      }

      onSubscribeSuccess('캘린더 구독에 성공했습니다.');
      onClose();
    } catch (err: any) {
      console.error('Subscription failed:', err);

      const errMsg = err?.message || '';
      if (errMsg.includes('All CORS proxies failed')) {
        setError('캘린더 서버에 접근할 수 없습니다.\n\n해당 주소가 외부에서 접근 가능한 캘린더 구독 주소인지 확인해주세요.');
      } else if (errMsg.includes('parse') || errMsg.includes('jCal') || errMsg.includes('invalid')) {
        setError('유효한 iCal 데이터가 아닙니다.\n\n이 주소가 캘린더 구독용(.ics) 주소가 맞는지 확인해주세요.\n일반 웹페이지 링크가 아닌, 캘린더 서비스의 "iCal 형식" 주소를 사용해야 합니다.');
      } else {
        setError('캘린더를 가져오는데 실패했습니다.\n\n올바른 캘린더 구독 주소인지 확인해주세요.\n캘린더 서비스의 설정에서 iCal 형식의 공개 또는 비공개 주소를 찾아 입력해주세요.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="subscribe-modal-container" className={styles.modalOverlay}>
      <div className={styles.modalBackdrop} onClick={loading ? undefined : onClose} />
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderSpacer}></div>
          <h2 className={styles.modalTitle}>캘린더 구독하기</h2>
          <div className={styles.modalHeaderSpacerEnd}>
            <button className={styles.modalCloseButton} onClick={onClose} disabled={loading}>
              <span className={`material-symbols-rounded ${styles.modalCloseIcon}`}>close</span>
            </button>
          </div>
        </div>

        <div className={styles.modalContent}>
          <form onSubmit={handleSubmit}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>캘린더 주소 (.ics)</label>
              <input
                type="text"
                placeholder="https://.../*.ics"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={styles.formInput}
                disabled={loading}
                autoFocus
              />
              <p className={styles.helpText}>
                캘린더 서비스의 설정에서 제공하는 iCal 형식의 구독 주소를 입력하세요.
              </p>
            </div>

            {error && <div className={styles.errorMessage} style={{ whiteSpace: 'pre-line' }}>{error}</div>}

            <button type="submit" className={styles.primaryButton} style={{ marginTop: '1rem' }} disabled={loading || !url.trim()}>
              {loading ? (
                <>
                  <div className={styles.spinner}></div>
                  <span>가져오는 중...</span>
                </>
              ) : (
                '구독하기'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
