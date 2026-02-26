import { useState, useRef, useEffect, useCallback } from 'react';
import { Event } from '../types';
import styles from './EventDetailModal.module.css';
import { MiniCalendar } from './MiniCalendar';

interface EventDetailModalProps {
  event: Event;
  onClose: () => void;
  onUpdate: (eventId: string, updates: Partial<Event>) => void;
  onDelete: (eventId: string) => void;
}

const COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
];

export function EventDetailModal({ event, onClose, onUpdate, onDelete }: EventDetailModalProps) {
  const [title, setTitle] = useState(event.title);
  const [memo, setMemo] = useState(event.memo || '');
  const [startTime, setStartTime] = useState(event.startTime || '');
  const [endTime, setEndTime] = useState(event.endTime || '');
  const [color, setColor] = useState(event.color);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstRender = useRef(true);

  // 색상 선택기 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 실시간 자동 저장 (디바운스)
  const saveChanges = useCallback(() => {
    onUpdate(event.id, {
      title: title.trim() || event.title, // 빈 제목 방지
      memo: memo.trim() || undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      color,
    });
  }, [event.id, event.title, title, memo, startTime, endTime, color, onUpdate]);

  // 필드 변경 시 자동 저장
  useEffect(() => {
    // 첫 렌더링 시에는 저장하지 않음
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // 이전 타이머 취소
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // 500ms 후 저장
    debounceRef.current = setTimeout(() => {
      saveChanges();
    }, 500);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [title, memo, startTime, endTime, color, saveChanges]);

  // 색상 변경은 즉시 저장
  const handleColorChange = (newColor: string) => {
    setColor(newColor);
    setShowColorPicker(false);
    // 즉시 저장
    onUpdate(event.id, {
      title: title.trim() || event.title,
      memo: memo.trim() || undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      color: newColor,
    });
  };

  // MiniCalendar State & Refs
  const [calendarTarget, setCalendarTarget] = useState<'start' | 'end' | null>(null);
  const startTimeRef = useRef<HTMLInputElement>(null);
  const endTimeRef = useRef<HTMLInputElement>(null);

  const handleDateSelect = (dateStr: string) => {
    if (calendarTarget === 'start') {
      const updates: any = { date: dateStr };
      // If start > end, auto-push end? For now just update start.
      onUpdate(event.id, updates);
    } else {
      onUpdate(event.id, { endDate: dateStr } as any);
    }
    setCalendarTarget(null);
  };

  const formatDateShort = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    const yy = date.getFullYear().toString().slice(2);
    const m = date.getMonth() + 1;
    const d = date.getDate();
    return `${yy}. ${m}. ${d}.`;
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h < 12 ? '오전' : '오후';
    const displayH = h % 12 || 12;
    return `${ampm} ${displayH}:${String(m).padStart(2, '0')}`;
  };

  const handleDelete = () => {
    onDelete(event.id);
    onClose();
  };

  return (
    <div className={styles.modalOverlay}>
      {/* 백드롭 - 흐림 효과 없음 */}
      <div
        className={styles.modalBackdrop}
        onClick={onClose}
      />

      {/* 모달 - 흰색 배경, 테두리, 패딩 */}
      <div className={styles.modal}>
        {/* 헤더 */}
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderLeft}>
            {/* 색상 칩 - 클릭하면 드롭다운 */}
            <div className={styles.colorPickerWrapper} ref={colorPickerRef}>
              <button
                onClick={() => setShowColorPicker(!showColorPicker)}
                className={styles.colorPickerButton}
                title="색상 변경"
              >
                <div
                  className={styles.colorChip}
                  style={{ backgroundColor: color }}
                />
                <span className={`material-symbols-rounded ${styles.colorPickerIcon}`}>expand_more</span>
              </button>

              {/* 색상 드롭다운 */}
              {showColorPicker && (
                <div className={styles.colorPickerDropdown}>
                  <div className={styles.colorPickerOptions}>
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => handleColorChange(c)}
                        className={`${styles.colorOption} ${color === c ? styles.colorOptionSelected : ''}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={styles.modalTitleInput}
              autoFocus
            />
          </div>
          <button
            onClick={onClose}
            className={styles.modalCloseButton}
          >
            <span className={`material-symbols-rounded ${styles.modalCloseIcon}`}>close</span>
          </button>
        </div>

        {/* 날짜/시간 섹션 */}
        <div className={styles.modalDateSection} style={{ position: 'relative' }}>
          <div className={styles.integratedDateTime}>
            <span
              className={styles.dateText}
              onClick={() => setCalendarTarget('start')}
              title="시작 날짜 변경"
            >
              {formatDateShort(event.date)}
            </span>
            <span
              className={styles.timeText}
              onClick={() => startTimeRef.current?.showPicker()}
              title="시작 시간 변경"
            >
              {formatTime(startTime) || '시간 선택'}
            </span>
            <span className={styles.separator}>~</span>
            <span
              className={styles.dateText}
              onClick={() => setCalendarTarget('end')}
              title="종료 날짜 변경"
            >
              {formatDateShort(event.endDate || event.date)}
            </span>
            <span
              className={styles.timeText}
              onClick={() => endTimeRef.current?.showPicker()}
              title="종료 시간 변경"
            >
              {formatTime(endTime) || '시간 선택'}
            </span>
          </div>

          <input
            type="time"
            ref={startTimeRef}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', top: 0, left: 0 }}
          />
          <input
            type="time"
            ref={endTimeRef}
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', top: 0, right: 0 }}
          />

          {calendarTarget && (
            <MiniCalendar
              startDate={event.date}
              endDate={event.endDate || event.date}
              target={calendarTarget}
              onSelect={handleDateSelect}
              onClose={() => setCalendarTarget(null)}
            />
          )}
        </div>

        {/* 메모 섹션 */}
        <div className={styles.modalMemoSection}>
          <label className={styles.modalMemoLabel}>메모</label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모, URL 또는 첨부 파일 추가"
            rows={5}
            className={styles.modalMemoTextarea}
          />
        </div>

        {/* 삭제 버튼 */}
        <div className={styles.modalDeleteSection}>
          <button
            onClick={handleDelete}
            className={styles.modalDeleteButton}
          >
            <span className={`material-symbols-rounded ${styles.modalDeleteIcon}`}>delete</span>
            일정 삭제
          </button>
        </div>
      </div>
    </div>
  );
}
