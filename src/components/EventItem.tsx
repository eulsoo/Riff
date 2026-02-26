import { memo } from 'react';
import { Event } from '../types';
import styles from './WeekCard.module.css';
import { useSelection } from '../contexts/SelectionContext';

interface EventItemProps {
  event: Event;
  onEventDoubleClick: (event: Event, anchorEl: HTMLElement) => void;
  onDeleteEvent: (eventId: string) => void;
  timeDisplay?: 'default' | 'start-only' | 'end-only';
  variant?: 'standard' | 'compact';
  hideDeleteButton?: boolean;
  className?: string;
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

export const EventItem = memo(function EventItem({
  event,
  onEventDoubleClick,
  onDeleteEvent: _onDeleteEvent,
  timeDisplay = 'default',
  variant = 'standard',
  hideDeleteButton: _hideDeleteButton = false,
  className
}: EventItemProps) {
  const { selectedIdsSet, toggleSelection } = useSelection();
  const isSelected = selectedIdsSet.has(event.id);

  // 8자리 HEX(#RRGGBBAA)인 경우 끝에 2자리(AA) 제거하여 6자리(#RRGGBB)로 만듦
  const baseColor = event.color.length > 7 ? event.color.substring(0, 7) : event.color;
  const backgroundColor = isSelected ? baseColor : baseColor + '20';
  const textColor = isSelected ? '#fff' : baseColor;

  const showTime = variant === 'standard' && (event.startTime || event.endTime);

  return (
    <div
      id={`event-item-${event.id}`}
      className={`${styles.eventItem} ${variant === 'compact' ? styles.eventItemCompact : ''} ${isSelected ? styles.eventItemSelected : ''} ${className || ''}`}
      data-event-item="true"
      style={{ backgroundColor, color: textColor }}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
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
