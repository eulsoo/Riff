import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Event } from '../types';
import { CalendarMetadata, normalizeCalendarUrl } from '../services/api';
import styles from './EventModal.module.css';
import { MiniCalendar } from './MiniCalendar';


export interface ModalPosition {
  top: number;
  left?: number;
  right?: number;
  align: 'left' | 'right';
}

interface EventModalProps {
  date: string;
  initialTitle?: string;
  initialStartTime?: string;
  initialEndTime?: string;
  event?: Event;
  calendars: CalendarMetadata[];
  allCalendars?: CalendarMetadata[];
  position?: ModalPosition | null;
  onClose: () => void;
  onSave: (event: Omit<Event, 'id'>, keepOpen?: boolean) => Promise<void> | void;
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

export function EventModal({ date, initialTitle, initialStartTime, initialEndTime, event, calendars, allCalendars, position, onClose, onSave, onUpdate, onDelete, onDraftUpdate }: EventModalProps) {
  const [title, setTitle] = useState(event?.title || initialTitle || '');
  const [memo, setMemo] = useState(event?.memo || '');
  const [isAllDay, setIsAllDay] = useState(() => {
    if (event) return !event.startTime && !event.endTime;
    if (initialStartTime || initialEndTime) return false;
    return false; // Default off for new clicked events if undefined
  });

  const [startTime, setStartTime] = useState(event?.startTime || initialStartTime || '09:00');
  const [endTime, setEndTime] = useState(event?.endTime || initialEndTime || '10:00');

  const [currentStartDate, setCurrentStartDate] = useState(event?.date || date);
  const [currentEndDate, setCurrentEndDate] = useState(event?.endDate || event?.date || date);
  const [calendarTarget, setCalendarTarget] = useState<'start' | 'end' | null>(null);

  const isSubscription = (() => {
    if (!event || !event.calendarUrl) return false;
    const cals = allCalendars || calendars;
    const cal = cals.find(c => c.url === event.calendarUrl);
    return cal?.isSubscription || cal?.type === 'subscription' || event.calendarUrl.endsWith('.ics');
  })();

  const handleDateSelect = (dStr: string) => {
    if (calendarTarget === 'start') {
      setCurrentStartDate(dStr);
      if (dStr > currentEndDate) setCurrentEndDate(dStr);
    } else {
      setCurrentEndDate(dStr);
      if (dStr < currentStartDate) setCurrentStartDate(dStr);
    }
    setCalendarTarget(null);
  };

  const formatDateShort = (dStr: string) => {
    const [y, m, d] = dStr.split('-').map(Number);
    return `${String(y).slice(2)}. ${m}. ${d}.`;
  };

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

  // --- Smart Auto-Save Logic ---
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const getCurrentData = useCallback(() => ({
    title: title.trim(),
    memo: memo.trim() || undefined,
    startTime: isAllDay ? undefined : (startTime || undefined),
    endTime: isAllDay ? undefined : (endTime || undefined),
    color: selectedCalendar?.color || '#3b82f6',
    calendarUrl: selectedCalendar?.url,
    date: currentStartDate,
    endDate: currentEndDate
  }), [title, memo, startTime, endTime, isAllDay, selectedCalendar, currentStartDate, currentEndDate]);

  const handleAutoSave = useCallback((isImmediate: boolean) => {
    // Clear any pending debounced save
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const performSave = () => {
      // 제목이 없거나, 새 일정인데 제목이 기본값인 경우 자동 저장 안함
      if (!title.trim() || (!event && title.trim() === '새로운 일정')) return;

      const currentData = getCurrentData();

      if (event) {
        if (onUpdate) {
          const isChanged =
            title !== event.title ||
            memo !== (event.memo || '') ||
            (isAllDay ? undefined : startTime) !== event.startTime ||
            (isAllDay ? undefined : endTime) !== event.endTime ||
            selectedCalendar?.url !== event.calendarUrl ||
            currentStartDate !== event.date ||
            currentEndDate !== (event.endDate || event.date);

          if (isChanged) {
            onUpdate(event.id, currentData);
          }
        }
      } else {
        // Create Mode: DO NOT SAVE TO DB AUTOMATICALLY during typing.
      }
    };

    if (isImmediate) {
      performSave();
    } else {
      saveTimerRef.current = setTimeout(performSave, 500);
    }
  }, [getCurrentData, event, onUpdate, onSave, title, memo, startTime, endTime, isAllDay, selectedCalendar, currentStartDate, currentEndDate]);

  // 1. Immediate Save Triggers (Layout / Critical)
  useEffect(() => {
    // Mount 시 실행되지만 performSave 내부에서 diff 체크로 불필요한 저장 방지됨
    handleAutoSave(true);
  }, [startTime, endTime, isAllDay, currentStartDate, currentEndDate, selectedCalendar?.url, handleAutoSave]);

  // 2. Debounced Save Triggers (Text Input)
  useEffect(() => {
    handleAutoSave(false);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [title, memo, handleAutoSave]);

  const currentColor = selectedCalendar?.color || '#3b82f6';

  // 드래프트 상태 동기화: 사용자가 입력할 때 서버 저장 전이라도 달력 미리보기 업데이트
  useEffect(() => {
    if (!event && onDraftUpdate) {
      onDraftUpdate({
        title: title.trim(),
        memo: memo.trim() || undefined,
        startTime: isAllDay ? undefined : (startTime || undefined),
        endTime: isAllDay ? undefined : (endTime || undefined),
        date: currentStartDate,
        endDate: currentEndDate,
        color: currentColor,
        calendarUrl: selectedCalendar?.url
      });
    }
  }, [title, memo, startTime, endTime, isAllDay, currentColor, selectedCalendar, event, onDraftUpdate, currentStartDate, currentEndDate]);

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



  const modalRef = useRef<HTMLDivElement>(null);

  // Keep latest state in ref for outside click handler without re-attaching listeners
  const latestStateRef = useRef({ title, memo, startTime, endTime, isAllDay, selectedCalendar, currentStartDate, currentEndDate, event });
  useEffect(() => {
    latestStateRef.current = { title, memo, startTime, endTime, isAllDay, selectedCalendar, currentStartDate, currentEndDate, event };
  }, [title, memo, startTime, endTime, isAllDay, selectedCalendar, currentStartDate, currentEndDate, event]);

  // Global Outside Click Listener
  useEffect(() => {
    const handleOutsideClick = async (e: MouseEvent) => {
      // Ignore if clicking inside the modal
      if (modalRef.current && modalRef.current.contains(e.target as Node)) {
        return;
      }

      // Force Save on Close Logic
      const s = latestStateRef.current;

      // 입력값이 있고, 새 일정인 경우 저장 시도
      if (!s.event) {
        // 무조건 저장 (제목 없으면 기본값 '새로운 일정')
        const titleToSend = s.title.trim() || '새로운 일정';

        const finalData = {
          title: titleToSend,
          memo: s.memo.trim() || undefined,
          startTime: s.isAllDay ? undefined : (s.startTime || undefined),
          endTime: s.isAllDay ? undefined : (s.endTime || undefined),
          color: s.selectedCalendar?.color || '#3b82f6',
          calendarUrl: s.selectedCalendar?.url,
          date: s.currentStartDate,
          endDate: s.currentEndDate
        };
        // Wait for save to complete (and context update) BEFORE closing
        // This prevents the draft from disappearing before the real event appears
        await onSave(finalData, false);
      } else {
        // 수정 모드의 경우 자동 저장이 동작하지만, 마지막 변경사항(Debounce 중인 것)을 여기서 즉시 처리할 수도 있음
        // 하지만 handleAutoSave가 있으므로 여기서는 생략하거나, 필요시 handleAutoSave(true) 호출 가능?
        // handleAutoSave는 scope 밖임.
        // 여기서는 안전하게 닫기만 함 (Update는 보통 타이핑 멈추면 저장되거나 Immediate Trigger로 저장됨)
        // *만약* 타이핑하다 바로 닫으면? -> Debounce 타이머가 Unmount 시 취소됨 -> 저장 안됨.
        // 수정 모드에서도 강제 저장이 필요할 수 있음.
        if (onUpdate && s.event) {
          const titleToSend = s.title.trim();
          const currentData = {
            title: titleToSend,
            memo: s.memo.trim() || undefined,
            startTime: s.isAllDay ? undefined : (s.startTime || undefined),
            endTime: s.isAllDay ? undefined : (s.endTime || undefined),
            color: s.selectedCalendar?.color || '#3b82f6',
            calendarUrl: s.selectedCalendar?.url,
            date: s.currentStartDate,
            endDate: s.currentEndDate
          };
          // Diff check could be good, but simple update is safer
          onUpdate(s.event.id, currentData);
        }
      }

      onClose();
    };

    // Use mousedown to capture intention immediately
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [onClose, onSave, onUpdate]);

  return (
    <div
      className={position ? styles.modalOverlayAbsolute : styles.modalOverlay}
    // onClick handler on overlay removed/kept as backup, but mousedown covers it.
    >
      <div
        className={styles.modalBackdrop}
      // onClick checked by mousedown
      />

      <div
        ref={modalRef}
        className={`${styles.modal} ${position ? styles.modalPositioned : ''}`}
        style={position ? (absoluteStyle || { visibility: 'hidden' }) : undefined}
      >
        {isPositioned && (
          <>

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
                    <span className={`material-symbols-rounded ${styles.calendarArrow}`} style={{ fontSize: '14px' }}>expand_more</span>
                  </button>

                  {isCalendarDropdownOpen && (
                    <div className={styles.calendarDropdown}>
                      {calendars.filter(c => !c.readOnly).map(cal => (
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

              <div className={styles.allDayToggleWrapper}>
                <span className={styles.allDayLabel}>하루 종일</span>
                <label className={styles.allDayToggleSwitch} style={{ '--highlight-color': currentColor } as React.CSSProperties}>
                  <input
                    type="checkbox"
                    checked={isAllDay}
                    onChange={(e) => setIsAllDay(e.target.checked)}
                  />
                  <span className={styles.allDayToggleSlider}></span>
                </label>
              </div>

              <div className={`${styles.inputWrapper} ${styles.dateTimeRow}`} style={{ position: 'relative' }}>
                <div className={styles.dateTimeGroup}>
                  <span
                    className={styles.dateText}
                    onClick={() => setCalendarTarget('start')}
                    title="시작 날짜 변경"
                  >
                    {formatDateShort(currentStartDate)}
                  </span>
                  {!isAllDay && (
                    <TimeInput
                      value={startTime}
                      onChange={setStartTime}
                      highlightColor={currentColor}
                    />
                  )}
                </div>

                <span className={styles.timeSeparator}>~</span>

                <div className={styles.dateTimeGroup}>
                  <span
                    className={styles.dateText}
                    onClick={() => setCalendarTarget('end')}
                    title="종료 날짜 변경"
                  >
                    {formatDateShort(currentEndDate)}
                  </span>
                  {!isAllDay && (
                    <TimeInput
                      value={endTime}
                      onChange={setEndTime}
                      highlightColor={currentColor}
                    />
                  )}
                </div>

                {calendarTarget && (
                  <MiniCalendar
                    startDate={currentStartDate}
                    endDate={currentEndDate}
                    target={calendarTarget}
                    onSelect={handleDateSelect}
                    onClose={() => setCalendarTarget(null)}
                  />
                )}
              </div>

              <div className={styles.inputWrapper}>
                <textarea
                  ref={memoRef}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="메모"
                  rows={2}
                  className={styles.memoTextarea}
                />
              </div>

              {event && (
                <div className={styles.deleteMenuWrapper}>
                  {isSubscription ? (
                    <div className={`${styles.deleteMenuButton} ${styles.deleteMenuDisabled}`} title="구독한 캘린더의 일정은 변경이나 삭제할 수 없습니다.">
                      <span className="material-symbols-rounded">delete</span>
                      일정 삭제 불가 (읽기 전용)
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.deleteMenuButton}
                      onClick={() => {
                        onDelete?.(event.id);
                        onClose();
                      }}
                    >
                      <span className="material-symbols-rounded">delete</span>
                      일정 삭제
                    </button>
                  )}
                </div>
              )}

            </div>

          </>
        )}
      </div>
    </div>
  );
}