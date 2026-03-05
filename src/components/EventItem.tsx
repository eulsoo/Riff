import { memo, useRef } from 'react';
import { Event } from '../types';
import styles from './WeekCard.module.css';
import { useSelection } from '../contexts/SelectionContext';
import { useDrag } from '../contexts/DragContext';

interface EventItemProps {
  event: Event;
  onEventDoubleClick: (event: Event, anchorEl: HTMLElement) => void;
  onDeleteEvent: (eventId: string) => void;
  timeDisplay?: 'default' | 'start-only' | 'end-only';
  variant?: 'standard' | 'compact';
  hideDeleteButton?: boolean;
  className?: string;
  isDragPreview?: boolean;
  isDragging?: boolean;
  isReadOnly?: boolean; // 구독/읽기전용 이벤트 여부
}

const formatEventTime = (startTime?: string, endTime?: string, displayMode: 'default' | 'start-only' | 'end-only' = 'default') => {
  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes}`;
  };

  if (displayMode === 'start-only' && startTime) {
    return `${formatTime(startTime)} ~`;
  }
  if (displayMode === 'end-only' && endTime) {
    return `~ ${formatTime(endTime)}`;
  }

  if (startTime && endTime) {
    return `${formatTime(startTime)} - ${formatTime(endTime)}`;
  } else if (startTime) {
    return formatTime(startTime);
  } else if (endTime) {
    return `~ ${formatTime(endTime)}`;
  }
  return '';
};

const DRAG_THRESHOLD = 5; // px: 이 거리를 넘어야 드래그로 인식

export const EventItem = memo(function EventItem({
  event,
  onEventDoubleClick,
  onDeleteEvent: _onDeleteEvent,
  timeDisplay = 'default',
  variant = 'standard',
  hideDeleteButton: _hideDeleteButton = false,
  className,
  isDragPreview: _isDragPreview = false,
  isDragging = false,
  isReadOnly = false,
}: EventItemProps) {
  const { selectedIdsSet, toggleSelection } = useSelection();
  const { startDrag, ghostRef } = useDrag();
  const isSelected = selectedIdsSet.has(event.id);

  // 8자리 HEX(#RRGGBBAA)인 경우 끝에 2자리(AA) 제거하여 6자리(#RRGGBB)로 만듦
  const baseColor = event.color.length > 7 ? event.color.substring(0, 7) : event.color;
  const backgroundColor = isSelected ? baseColor : baseColor + '20';
  const textColor = isSelected ? '#fff' : baseColor;

  const showTime = variant === 'standard' && (event.startTime || event.endTime);

  // --- Drag Logic ---
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const dragStartedRef = useRef(false);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    mouseDownPos.current = { x: e.clientX, y: e.clientY };
    dragStartedRef.current = false;

    const onMouseMove = (me: MouseEvent) => {
      if (!mouseDownPos.current) return;

      const dx = Math.abs(me.clientX - mouseDownPos.current.x);
      const dy = Math.abs(me.clientY - mouseDownPos.current.y);

      if (!dragStartedRef.current && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
        dragStartedRef.current = true;

        // isReadOnly이면 startDrag 내부에서 차단 + 토스트 표시
        startDrag(event, event.date, isReadOnly);
        if (isReadOnly) {
          mouseDownPos.current = null;
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          return;
        }

        // Ghost 엘리먼트 생성 (순수 DOM - 성능 최적화)
        const el = document.getElementById(`event-item-${event.id}`);
        if (el) {
          const ghost = el.cloneNode(true) as HTMLDivElement;
          ghost.style.cssText = `
            position: fixed;
            pointer-events: none;
            opacity: 0.6;
            z-index: 9999;
            width: ${el.offsetWidth}px;
            margin: 0;
            box-shadow: 0 8px 24px rgba(0,0,0,0.18);
            border-radius: 4px;
            transform: rotate(2deg) scale(1.03);
            transition: none;
          `;
          ghost.style.left = `${me.clientX - el.offsetWidth / 2}px`;
          ghost.style.top = `${me.clientY - el.offsetHeight / 2}px`;
          document.body.appendChild(ghost);
          ghostRef.current = ghost;
        }
      }

      // Ghost 따라다니기
      if (dragStartedRef.current && ghostRef.current) {
        const el = document.getElementById(`event-item-${event.id}`);
        const w = el ? el.offsetWidth : 120;
        const h = el ? el.offsetHeight : 28;
        ghostRef.current.style.left = `${me.clientX - w / 2}px`;
        ghostRef.current.style.top = `${me.clientY - h / 2}px`;
      }
    };

    const onMouseUp = () => {
      mouseDownPos.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // 실제 drop 처리는 MainLayout의 전역 mouseup에서 수행
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const opacity = isDragging ? 0.7 : 1;

  return (
    <div
      id={`event-item-${event.id}`}
      className={`${styles.eventItem} ${variant === 'compact' ? styles.eventItemCompact : ''} ${isSelected ? styles.eventItemSelected : ''} ${className || ''}`}
      data-event-item="true"
      style={{ backgroundColor, color: textColor, opacity, transition: 'opacity 0.1s' }}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
        handleMouseDown(e);
      }}
      onClick={e => {
        if (dragStartedRef.current) { e.stopPropagation(); return; }
        e.stopPropagation();
        toggleSelection(event.id, e.shiftKey);
      }}
      onDoubleClick={e => {
        e.stopPropagation();
        onEventDoubleClick(event, e.currentTarget);
      }}
    >
      {showTime && (
        <div className={styles.eventTime}>
          {formatEventTime(event.startTime, event.endTime, timeDisplay)}
        </div>
      )}
      <div className={styles.eventTitle}>{event.title}</div>
      {event.memo && (
        <span className={`material-symbols-rounded ${styles.eventMemoIcon}`} style={{ fontSize: '14px' }}>
          notes
        </span>
      )}
    </div>
  );
});
