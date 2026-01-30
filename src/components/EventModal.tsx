import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { X, ChevronDown, Trash2 } from 'lucide-react';
import { Event } from '../types';
import { CalendarMetadata, normalizeCalendarUrl } from '../services/api';
import styles from './EventModal.module.css';


export interface ModalPosition {
  top: number;
  left?: number;
  right?: number;
  align: 'left' | 'right';
}

interface EventModalProps {
  date: string;
  initialTitle?: string;
  event?: Event;
  calendars: CalendarMetadata[];
  position?: ModalPosition | null;
  onClose: () => void;
  onSave: (event: Omit<Event, 'id'>, keepOpen?: boolean) => void;
  onUpdate?: (eventId: string, updates: Partial<Event>) => void;
  onDelete?: (eventId: string) => void;
  onDraftUpdate?: (updates: Partial<Event>) => void;
}

// Custom Time Input Component
interface TimeInputProps {
  value: string; // "HH:mm" (24h)
  onChange: (val: string) => void;
  highlightColor: string;
}

function TimeInput({ value, onChange, highlightColor }: TimeInputProps) {
  // Parse 24h "HH:mm" to 12h parts
  const parseTime = (v: string) => {
    const [h, m] = v.split(':').map(Number);
    const isPm = h >= 12;
    const ampm = isPm ? '오후' : '오전';
    const hour12 = h % 12 || 12;
    const minute = m;
    return { ampm, hour12, minute };
  };

  const { ampm, hour12, minute } = parseTime(value);

  const updateTime = (newAmpm: string, newH: number, newM: number) => {
    let h24 = newH === 12 ? 0 : newH;
    if (newAmpm === '오후') {
      h24 = h24 + 12;
    }
    // Handle 12 AM/PM edge cases
    if (newAmpm === '오전' && newH === 12) h24 = 0;
    if (newAmpm === '오후' && newH === 12) h24 = 12;

    const hStr = String(h24).padStart(2, '0');
    const mStr = String(newM).padStart(2, '0');
    onChange(`${hStr}:${mStr}`);
  };

  const handleAmpmChange = () => {
    const newAmpm = ampm === '오전' ? '오후' : '오전';
    updateTime(newAmpm, hour12, minute);
  };

  const handleHourChange = (delta: number) => {
    let newH = hour12 + delta;
    if (newH > 12) newH = 1;
    if (newH < 1) newH = 12;
    updateTime(ampm, newH, minute);
  };

  const handleMinuteChange = (delta: number) => {
    let newM = minute + delta;
    if (newM > 59) newM = 0;
    if (newM < 0) newM = 59;
    updateTime(ampm, hour12, newM);
  };

  const handleHourInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseInt(e.target.value);
    if (isNaN(val)) return;
    if (val > 12) val = 12;
    if (val < 0) val = 0;
    if (val === 0) return;
    updateTime(ampm, val, minute);
  };

  const handleMinuteInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseInt(e.target.value);
    if (isNaN(val)) return;
    if (val > 59) val = 59;
    if (val < 0) val = 0;
    updateTime(ampm, hour12, val);
  };

  return (
    <div className={styles.customTimeInput}>
      <div
        className={styles.timeSegment}
        tabIndex={0}
        onClick={handleAmpmChange}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleAmpmChange();
          }
        }}
        style={{ '--highlight-color': highlightColor } as React.CSSProperties}
      >
        {ampm}
      </div>

      <input
        type="text"
        inputMode="numeric"
        className={styles.timeNumInput}
        value={hour12}
        onChange={handleHourInput}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); handleHourChange(1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); handleHourChange(-1); }
        }}
        onFocus={(e) => e.target.select()}
        style={{ '--highlight-color': highlightColor } as React.CSSProperties}
      />

      <span className={styles.timeColon}>:</span>

      <input
        type="text"
        inputMode="numeric"
        className={styles.timeNumInput}
        value={String(minute).padStart(2, '0')}
        onChange={handleMinuteInput}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); handleMinuteChange(1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); handleMinuteChange(-1); }
        }}
        onFocus={(e) => e.target.select()}
        style={{ '--highlight-color': highlightColor } as React.CSSProperties}
      />
    </div>
  );
}

export function EventModal({ date, initialTitle, event, calendars, position, onClose, onSave, onUpdate, onDelete, onDraftUpdate }: EventModalProps) {
  // 이 모달 세션이 "새 일정 생성"으로 시작했는지 기억 (저장 후에도 삭제 버튼 숨김)
  const isCreateSession = useRef(!event);

  const [title, setTitle] = useState(event?.title || initialTitle || '');
  const [memo, setMemo] = useState(event?.memo || '');
  const [startTime, setStartTime] = useState(event?.startTime || '09:00');
  const [endTime, setEndTime] = useState(event?.endTime || '10:00');

  // 기본 캘린더 선택
  const [selectedCalendar, setSelectedCalendar] = useState<CalendarMetadata | null>(() => {
    if (event?.calendarUrl) {
      const targetUrl = normalizeCalendarUrl(event.calendarUrl);
      return calendars.find(c => normalizeCalendarUrl(c.url) === targetUrl) || null;
    }
    return calendars.length > 0 ? calendars[0] : null;
  });

  const [isCalendarDropdownOpen, setIsCalendarDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsCalendarDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-Save Effect
  useEffect(() => {
    const timer = setTimeout(() => {
      // 제목이 없거나, 새 일정인데 제목이 기본값인 경우 자동 저장 안함
      if (!title.trim() || (!event && title.trim() === '새로운 일정')) return;

      const currentData = {
        title: title.trim(),
        memo: memo.trim() || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        color: selectedCalendar?.color || '#3b82f6',
        calendarUrl: selectedCalendar?.url
      };

      if (event) {
        if (onUpdate) {
          const isChanged =
            title !== event.title ||
            memo !== (event.memo || '') ||
            startTime !== (event.startTime || '09:00') ||
            endTime !== (event.endTime || '10:00') ||
            selectedCalendar?.url !== event.calendarUrl;

          if (isChanged) {
            onUpdate(event.id, currentData);
          }
        }
      } else {
        // Create Mode: Only save if user has changed something
        onSave({ ...currentData, date }, true);
      }
    }, 1000); // 1초 뒤에 저장 (사용자가 입력할 시간을 충분히 줌)
    return () => clearTimeout(timer);
  }, [title, memo, startTime, endTime, selectedCalendar, event, onUpdate, onSave, date]);

  const currentColor = selectedCalendar?.color || '#3b82f6';

  // 드래프트 상태 동기화: 사용자가 입력할 때 서버 저장 전이라도 달력 미리보기 업데이트
  useEffect(() => {
    if (!event && onDraftUpdate) {
      onDraftUpdate({
        title: title.trim(),
        memo: memo.trim() || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        color: currentColor,
        calendarUrl: selectedCalendar?.url
      });
    }
  }, [title, memo, startTime, endTime, currentColor, selectedCalendar, event, onDraftUpdate]);

  const memoRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (memoRef.current) {
      memoRef.current.style.height = 'auto';
      memoRef.current.style.height = `${memoRef.current.scrollHeight}px`;
    }
  }, [memo]);

  const [styleState, setStyleState] = useState<{ top: number, left?: number, right?: number }>();

  useLayoutEffect(() => {
    if (!position) return;
    setStyleState({
      top: position.top,
      left: position.left,
      right: position.right
    });
  }, [position]);

  const absoluteStyle: React.CSSProperties | undefined = styleState ? {
    position: 'absolute',
    top: styleState.top,
    left: styleState.left,
    right: styleState.right,
    transform: 'none',
    margin: 0,
  } : undefined;

  const isPositioned = !position || styleState !== undefined;

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (event && onDelete) {
      if (window.confirm('정말 삭제하시겠습니까?')) {
        onDelete(event.id);
        onClose();
      }
    }
  };

  const formattedDateLine = (() => {
    const [y, m, d] = date.split('-').map(Number);
    return `${y}. ${m}. ${d}.`;
  })();

  // currentColor is already defined above, no need to redefine
  // const currentColor = selectedCalendar?.color || '#3b82f6';

  return (
    <div className={position ? styles.modalOverlayAbsolute : styles.modalOverlay}>
      <div
        className={styles.modalBackdrop}
        onClick={onClose}
      />

      <div
        className={`${styles.modal} ${position ? styles.modalPositioned : ''}`}
        style={position ? (absoluteStyle || { visibility: 'hidden' }) : undefined}
      >
        {isPositioned && (
          <>
            {position && (
              <div
                className={`${styles.modalArrow} ${position.align === 'left' ? styles.arrowLeft : styles.arrowRight}`}
                style={{
                  top: '20px'
                }}
              />
            )}
            <div className={styles.modalForm}>

              <div className={`${styles.inputWrapper} ${styles.titleRow}`}>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="새로운 일정"
                  className={styles.titleInput}
                  autoFocus
                />

                <div className={styles.calendarSelector} ref={dropdownRef}>
                  <button
                    type="button"
                    className={styles.calendarConfigButton}
                    onClick={() => setIsCalendarDropdownOpen(!isCalendarDropdownOpen)}
                    title={selectedCalendar?.displayName || '캘린더 선택'}
                  >
                    <div
                      className={styles.calendarDot}
                      style={{ backgroundColor: currentColor }}
                    />
                    <ChevronDown size={14} className={styles.calendarArrow} />
                  </button>

                  {isCalendarDropdownOpen && (
                    <div className={styles.calendarDropdown}>
                      {calendars.map(cal => (
                        <button
                          key={cal.url}
                          type="button"
                          className={styles.calendarOption}
                          onClick={() => {
                            setSelectedCalendar(cal);
                            setIsCalendarDropdownOpen(false);
                          }}
                        >
                          <span
                            className={styles.calendarOptionDot}
                            style={{ backgroundColor: cal.color }}
                          />
                          <span className={styles.calendarOptionName}>{cal.displayName}</span>
                          {cal.isLocal && <span className={styles.localBadge}>로컬</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className={`${styles.inputWrapper} ${styles.dateTimeRow}`}>
                <span className={styles.dateText}>{formattedDateLine}</span>
                <TimeInput
                  value={startTime}
                  onChange={setStartTime}
                  highlightColor={currentColor}
                />
                <span className={styles.timeSeparator}>~</span>
                <TimeInput
                  value={endTime}
                  onChange={setEndTime}
                  highlightColor={currentColor}
                />
              </div>

              <div className={styles.inputWrapper}>
                <textarea
                  ref={memoRef}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="메모"
                  rows={1}
                  className={styles.memoTextarea}
                />
              </div>


            </div>


          </>
        )}
      </div>
    </div>
  );
}