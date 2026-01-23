import { useState } from 'react';
import { X } from 'lucide-react';
import { Event } from '../App';
import styles from './EventModal.module.css';

interface EventModalProps {
  date: string;
  onClose: () => void;
  onSave: (event: Omit<Event, 'id'>) => void;
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

export function EventModal({ date, onClose, onSave }: EventModalProps) {
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [color, setColor] = useState(COLORS[0]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = dayNames[date.getDay()];

    return `${year}년 ${month}월 ${day}일 (${dayName})`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onSave({
      date,
      title: title.trim(),
      memo: memo.trim() || undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      color,
    });

    setTitle('');
    setMemo('');
    setStartTime('');
    setEndTime('');
  };

  return (
    <div className={styles.modalOverlay}>
      {/* 백드롭 */}
      <div
        className={styles.modalBackdrop}
        onClick={onClose}
      />

      {/* 모달 */}
      <div className={styles.modal}>
        {/* 헤더 */}
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderContent}>
            <h2>일정 추가</h2>
            <p>{formatDate(date)}</p>
          </div>
          <button
            onClick={onClose}
            className={styles.modalCloseButton}
          >
            <X className={styles.modalCloseIcon} />
          </button>
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className={styles.modalForm}>
          {/* 제목 입력 */}
          <div className={styles.formGroup}>
            <label htmlFor="title" className={styles.formLabel}>
              일정 제목
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="일정을 입력하세요"
              className={styles.formInput}
              autoFocus
            />
          </div>

          {/* 메모 입력 */}
          <div className={styles.formGroup}>
            <label htmlFor="memo" className={styles.formLabel}>
              메모 (선택사항)
            </label>
            <textarea
              id="memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모를 입력하세요"
              rows={3}
              className={styles.formTextarea}
            />
          </div>

          {/* 시간 입력 */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              시간 (선택사항)
            </label>
            <div className={styles.timeInputs}>
              <div>
                <label htmlFor="startTime" className={styles.formLabelSmall}>
                  시작 시간
                </label>
                <input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={styles.formInput}
                />
              </div>
              <div>
                <label htmlFor="endTime" className={styles.formLabelSmall}>
                  종료 시간
                </label>
                <input
                  id="endTime"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={styles.formInput}
                />
              </div>
            </div>
          </div>

          {/* 색상 선택 */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              라벨 색상
            </label>
            <div className={styles.colorPicker}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`${styles.colorButton} ${color === c ? styles.colorButtonSelected : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* 버튼 */}
          <div className={styles.modalActions}>
            <button
              type="button"
              onClick={onClose}
              className={`${styles.modalButton} ${styles.modalButtonCancel}`}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className={`${styles.modalButton} ${styles.modalButtonSubmit}`}
            >
              추가
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}