import { useState, useMemo, useEffect, useRef } from 'react';
import styles from './MiniCalendar.module.css';

interface MiniCalendarProps {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  target: 'start' | 'end';
  onSelect: (dateStr: string) => void;
  onClose: () => void;
  hasDeadline?: boolean;
  onToggleDeadline?: (enabled: boolean) => void;
}

export function MiniCalendar({ startDate, endDate, target, onSelect, onClose, hasDeadline = true, onToggleDeadline }: MiniCalendarProps) {
  // Initialize view based on current target date
  const [viewDate, setViewDate] = useState(() => {
    const initialDateStr = target === 'start' ? startDate : endDate;
    return initialDateStr ? new Date(initialDateStr) : new Date();
  });

  const cardRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth(); // 0-indexed

  // Calendar Logic
  const calendarData = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDayOfMonth.getDay(); // 0(Sun) - 6(Sat)
    const daysInMonth = lastDayOfMonth.getDate();

    const days = [];

    // Prev Month Padding
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ day: null, dateStr: '' }); // Or calculcate prev dates if needed
    }

    // Current Month
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(year, month, i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      days.push({ day: i, dateStr: `${yyyy}-${mm}-${dd}` });
    }

    return days;
  }, [year, month]);

  const handlePrevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const handleNextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setViewDate(new Date(parseInt(e.target.value), month, 1));
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setViewDate(new Date(year, parseInt(e.target.value), 1));
  };

  // Generate Year Options (Current +/- 10)
  const years = Array.from({ length: 21 }, (_, i) => year - 10 + i);
  const months = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

  return (
    <div className={styles.calendarPopup} ref={cardRef}>
      {/* 1행: 마감일 설정 토글 */}
      {onToggleDeadline && (
        <div className={styles.deadlineToggleRow}>
          <span className={styles.deadlineToggleLabel}>마감일 설정</span>
          <label className={styles.toggleSwitch}>
            <input
              type="checkbox"
              checked={hasDeadline}
              onChange={(e) => onToggleDeadline(e.target.checked)}
            />
            <span className={styles.toggleSlider}></span>
          </label>
        </div>
      )}

      {/* 달력 영역: 스위치 OFF일 때 반투명하게 */}
      <div className={`${styles.calendarContent} ${!hasDeadline ? styles.calendarContentDisabled : ''}`}>
        <div className={styles.header}>
          <div className={styles.selectGroup}>
            <select value={year} onChange={handleYearChange} className={styles.systemSelect}>
              {years.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select value={month} onChange={handleMonthChange} className={styles.systemSelect}>
              {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
          <div className={styles.navControls}>
            <button onClick={handlePrevMonth} className={styles.navButton}>
              <span className="material-symbols-rounded" style={{ fontSize: '1.2rem' }}>chevron_left</span>
            </button>
            <button onClick={handleNextMonth} className={styles.navButton}>
              <span className="material-symbols-rounded" style={{ fontSize: '1.2rem' }}>chevron_right</span>
            </button>
          </div>
        </div>

        <div className={styles.grid}>
          {['일', '월', '화', '수', '목', '금', '토'].map(d => (
            <div key={d} className={styles.dayName}>{d}</div>
          ))}
          {calendarData.map((item, idx) => {
            if (!item.day) return <div key={idx} />;

            const isStart = item.dateStr === startDate;
            const isEnd = item.dateStr === endDate;
            const isSelected = isStart || isEnd;
            const isInRange = startDate && endDate && item.dateStr > startDate && item.dateStr < endDate;

            // Visual Classes
            let classNames = styles.dayCell;
            if (isSelected) classNames += ` ${styles.dayCellSelected}`;
            if (isInRange) classNames += ` ${styles.dayCellInRange}`;
            if (isStart && endDate && item.dateStr < endDate) classNames += ` ${styles.dayCellRangeStart}`;
            if (isEnd && startDate && item.dateStr > startDate) classNames += ` ${styles.dayCellRangeEnd}`;

            return (
              <div
                key={idx}
                className={classNames}
                onClick={() => onSelect(item.dateStr)}
              >
                {item.day}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
