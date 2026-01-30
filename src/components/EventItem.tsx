import { memo } from 'react';
import { X } from 'lucide-react';
import { Event } from '../types';
import styles from './WeekCard.module.css';

import { useSelection } from '../contexts/SelectionContext';

interface EventItemProps {
  event: Event;
  onEventDoubleClick: (event: Event, anchorEl: HTMLElement) => void;
  onDeleteEvent: (eventId: string) => void;
}

const formatEventTime = (startTime?: string, endTime?: string) => {
  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  if (startTime && endTime) {
    return `${formatTime(startTime)} - ${formatTime(endTime)}`;
  } else if (startTime) {
    return formatTime(startTime);
  } else if (endTime) {
    return `~ ${formatTime(endTime)}`;
  }
  return '';
};

export const EventItem = memo(function EventItem({
  event,
  onEventDoubleClick,
  onDeleteEvent
}: EventItemProps) {
  const { selectedIdsSet, toggleSelection } = useSelection();
  const isSelected = selectedIdsSet.has(event.id);

  return (
    <div
      id={`event-item-${event.id}`}
      className={`${styles.eventItem} ${isSelected ? styles.eventItemSelected : ''}`}
      data-event-item="true"
      style={(() => {
        // 8자리 HEX(#RRGGBBAA)인 경우 끝에 2자리(AA) 제거하여 6자리(#RRGGBB)로 만듦
        const baseColor = event.color.length > 7 ? event.color.substring(0, 7) : event.color;
        return isSelected
          ? { backgroundColor: baseColor, color: '#fff' }
          : { backgroundColor: baseColor + '20', color: baseColor };
      })()}
      onMouseDown={(e) => {
        // Shift 선택 시 텍스트 드래그 기본 동작 방지
        if (e.shiftKey) {
          e.preventDefault();
        }
      }}
      onClick={e => {
        e.stopPropagation();
        toggleSelection(event.id, e.shiftKey);
      }}
      onDoubleClick={e => {
        e.stopPropagation();
        onEventDoubleClick(event, e.currentTarget);
      }}
    >
      <div className={styles.eventContent}>
        <div className={styles.eventContentLeft}>
          {(event.startTime || event.endTime) && (
            <div className={styles.eventTime}>
              {formatEventTime(event.startTime, event.endTime)}
            </div>
          )}
          <div className={styles.eventTitle}>{event.title}</div>
        </div>
        <button
          onClick={e => {
            e.stopPropagation();
            onDeleteEvent(event.id);
          }}
          className={`${styles.eventDeleteButton} ${isSelected ? styles.eventDeleteButtonSelected : ''}`}
          aria-label="일정 삭제"
        >
          <X className={styles.eventDeleteIcon} />
        </button>
      </div>
    </div>
  );
});
