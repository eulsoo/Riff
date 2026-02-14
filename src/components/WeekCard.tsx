import { memo } from 'react';
import { EventItem } from './EventItem';
import { Event, Routine, RoutineCompletion, Todo, WeekOrder } from '../types';
import { RoutineIcon } from './RoutineIcon';
import { TodoList } from './TodoList';
import { useHover } from '../contexts/SelectionContext';
import { useAllDayEventLayout } from '../hooks/useAllDayEventLayout';
import styles from './WeekCard.module.css';

interface WeekCardProps {
  weekStart: Date;
  todoWeekStart: string; // Key for todo lookup (may differ from weekStart for sun-start weeks)
  events: Event[];
  routines: Routine[];
  routineCompletions: RoutineCompletion[];
  todos: Todo[];
  weekOrder: WeekOrder;
  onDateClick: (date: string, anchorEl?: HTMLElement, timeSlot?: 'am' | 'pm') => void;
  onEventDoubleClick: (event: Event, anchorEl?: HTMLElement) => void;
  onDeleteEvent: (eventId: string) => void;
  onToggleRoutine: (routineId: string, date: string) => void;
  onAddTodo: (weekStart: string, text: string, deadline?: string) => void;
  onToggleTodo: (todoId: string) => void;
  onUpdateTodo: (todoId: string, text: string, deadline?: string) => void;
  onDeleteTodo: (todoId: string) => void;
  onReorderTodos: (weekStart: string, newTodos: Todo[]) => void;
  onOpenDiary: (date: string) => void;
  diaryCompletions: Record<string, boolean>;
  weekStatus: 'current' | 'prev' | 'next' | 'other';
  showRoutines: boolean;
  showTodos: boolean;
}

const DIARY_ROUTINE: Routine = {
  id: 'diary',
  name: '일기쓰기',
  icon: 'note_alt',
  color: '#8b5cf6',
  days: [],
};

export const WeekCard = memo(function WeekCard({
  weekStart,
  todoWeekStart,
  events,
  routines,
  routineCompletions,
  todos,
  weekOrder,
  onDateClick,
  onEventDoubleClick,
  onDeleteEvent,
  onToggleRoutine,
  onAddTodo,
  onToggleTodo,
  onUpdateTodo,
  onDeleteTodo,
  onReorderTodos,
  onOpenDiary,
  diaryCompletions,
  weekStatus,
  showRoutines,
  showTodos,
}: WeekCardProps) {
  const { setHoveredDate } = useHover();
  // Performance Monitoring

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    return date;
  });

  // --- All-Day Events Logic (extracted to hook) ---
  const { visibleAllDayEvents, multiDayEventKeys } = useAllDayEventLayout(events, weekStart);


  const getWeekLabelInfo = () => {
    const getWeekOfMonth = (targetDate: Date) => {
      const year = targetDate.getFullYear();
      const monthIndex = targetDate.getMonth();
      const firstDayOfMonth = new Date(year, monthIndex, 1);
      const firstWeekStart = new Date(firstDayOfMonth);
      const firstDayOfWeek = firstDayOfMonth.getDay();
      const daysToWeekStart = weekOrder === 'sun'
        ? -firstDayOfWeek
        : (firstDayOfWeek === 0 ? -6 : 1 - firstDayOfWeek);
      firstWeekStart.setDate(firstDayOfMonth.getDate() + daysToWeekStart);

      const diffTime = weekStart.getTime() - firstWeekStart.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      return Math.floor(diffDays / 7) + 1;
    };

    const monthEntries = new Map<string, Date>();
    days.forEach(date => {
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (!monthEntries.has(key)) {
        monthEntries.set(key, date);
      }
    });

    const parts = Array.from(monthEntries.values()).map(date => {
      const month = date.getMonth() + 1;
      const weekOfMonth = getWeekOfMonth(date);
      return `${month}월 ${weekOfMonth}주차`;
    });

    return {
      label: `${parts.join(' / ')}`,
      isMultiMonth: parts.length > 1,
    };
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const getEventsForDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    return events.filter(event => {
      if (event.date !== dateStr) return false;
      // Exclude ONLY Multi-Day events (handled in All-Day Row)
      if (multiDayEventKeys.has(event.id)) return false;
      return true;
    });
  };

  const getRoutinesForDay = (dayIndex: number) => {
    return routines.filter(routine => routine.days.includes(dayIndex));
  };

  const isRoutineCompleted = (routineId: string, date: string) => {
    const completion = routineCompletions.find(
      rc => rc.routineId === routineId && rc.date === date
    );
    return completion?.completed || false;
  };

  const shouldShowRoutine = (routine: Routine, date: Date) => {
    // 1. Future check
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (checkDate > today) return false;

    // 2. Creation check
    if (routine.createdAt) {
      const createdDate = new Date(routine.createdAt);
      createdDate.setHours(0, 0, 0, 0);
      if (checkDate < createdDate) return false;
    }

    return true;
  };



  const getWeekGridClassName = () => {
    if (weekStatus === 'current') {
      return `${styles.weekGrid} ${styles.weekGridCurrent}`;
    } else if (weekStatus === 'prev' || weekStatus === 'next') {
      return `${styles.weekGrid} ${styles.weekGridPrevNext}`;
    }
    return `${styles.weekGrid} ${styles.weekGridOther}`;
  };

  // 주간 고유 ID 생성 (스크롤 복원용)
  const weekId = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;

  const { label: weekLabel } = getWeekLabelInfo();

  return (
    <div className={styles.weekCard} data-week-id={weekId}>
      {/* 7일 그리드 */}
      <div className={getWeekGridClassName()}>

        {/* 1. Header Row (Row 1) */}
        {days.map((date, index) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;
          const today = isToday(date);
          const dayNames = weekOrder === 'sun'
            ? ['일', '월', '화', '수', '목', '금', '토']
            : ['월', '화', '수', '목', '금', '토', '일'];
          const isWeekend = weekOrder === 'sun' ? (index === 0 || index === 6) : (index === 5 || index === 6);

          return (
            <div
              key={`header-${dateStr}`}
              className={`${styles.dayHeader} ${index === 6 ? styles.lastColumn : ''}`}
              onMouseEnter={() => setHoveredDate(dateStr)}
              onMouseLeave={() => setHoveredDate(null)}
            >
              {index === 0 && (
                <div className={styles.weekLabelContainer}>
                  <span className={styles.weekLabelText}>{weekLabel}</span>
                </div>
              )}
              {/* Spacer needed if not first day, or use flexbox effectively */}
              {index !== 0 && <div style={{ flex: 1 }} />}

              <div className={styles.dayMeta}>
                <span
                  className={`${styles.dayName} ${isWeekend ? styles.dayNameWeekend : styles.dayNameWeekday
                    }`}
                >
                  {dayNames[index]}
                </span>
                <div
                  className={`${styles.dayNumber} ${today
                    ? styles.dayNumberToday
                    : isWeekend
                      ? styles.dayNumberWeekend
                      : styles.dayNumberWeekday
                    }`}
                >
                  {date.getDate()}
                </div>
              </div>
            </div>
          );
        })}



        {/* 1.5 All-Day Events Row (Row 2) */}
        {visibleAllDayEvents.length > 0 && (
          <div className={styles.allDayRow} style={{ gridRow: 2 }}>
            <div className={styles.allDayRowBackground}>
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className={styles.allDayRowCol} />
              ))}
            </div>
            {visibleAllDayEvents.map(ve => (
              <div
                key={`${ve.id}-allDay-${ve.startIdx}`}
                className={`${styles.allDayItemContainer}${ve.span === 1 ? ` ${styles.allday}` : ''}`}
                style={{
                  gridColumnStart: ve.startIdx + 1,
                  gridColumnEnd: ve.startIdx + 1 + ve.span,
                  gridRow: ve.track + 1,
                }}
              >
                <EventItem
                  event={ve.event}
                  variant="compact"
                  onEventDoubleClick={onEventDoubleClick}
                  onDeleteEvent={onDeleteEvent}
                />
              </div>
            ))}
          </div>
        )}

        {/* 2. AM Events Row (Row 3) */}
        {days.map((date, index) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;

          const dayEvents = getEventsForDate(date);

          // Split into two groups:
          // 1. All-Day events (no startTime) - always at TOP
          // 2. Timed AM events (startTime < 12:00) - at BOTTOM (near divider if spanning)
          const allDayEvents = dayEvents.filter(e => !e.startTime);
          const timedAmEvents = dayEvents.filter(e => {
            if (!e.startTime) return false;
            const startHour = parseInt(e.startTime.split(':')[0]);
            return startHour < 12;
          });

          // Sort timed events by start time
          timedAmEvents.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

          // Check if any timed event spans across 12:00
          const hasSpanningEvents = timedAmEvents.some(event => {
            if (event.startTime && event.endTime) {
              return event.startTime < '12:00' && event.endTime > '12:00';
            }
            return false;
          });

          return (
            <div
              key={`am-${dateStr}`}
              className={`${styles.amEvents} ${index === 6 ? styles.lastColumn : ''}`}
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest('[data-event-item]')) return;
                onDateClick(dateStr, e.currentTarget, 'am');
              }}
              onMouseEnter={() => setHoveredDate(dateStr)}
              onMouseLeave={() => setHoveredDate(null)}
            >
              {/* Group 1: All-Day Events - Always at TOP */}
              {allDayEvents.length > 0 && (
                <div className={styles.eventsList} style={{ justifyContent: 'flex-start' }}>
                  {allDayEvents.map(event => (
                    <EventItem
                      key={event.id}
                      event={event}
                      onEventDoubleClick={onEventDoubleClick}
                      onDeleteEvent={onDeleteEvent}
                      variant="compact"
                      className={styles.allday}
                    />
                  ))}
                </div>
              )}

              {/* Group 2: Timed AM Events - At BOTTOM if spanning, otherwise after all-day */}
              {timedAmEvents.length > 0 && (
                <div
                  className={styles.eventsList}
                  style={{
                    justifyContent: hasSpanningEvents ? 'flex-end' : 'flex-start',
                    flex: hasSpanningEvents ? 1 : 'none'
                  }}
                >
                  {timedAmEvents.map(event => {
                    let timeDisplay: 'default' | 'start-only' | 'end-only' = 'default';
                    if (event.startTime && event.endTime) {
                      if (event.startTime < '12:00' && event.endTime > '12:00') {
                        timeDisplay = 'start-only';
                      }
                    }

                    return (
                      <EventItem
                        key={event.id}
                        event={event}
                        onEventDoubleClick={onEventDoubleClick}
                        onDeleteEvent={onDeleteEvent}
                        timeDisplay={timeDisplay}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* 3. Divider Line (Row 3) - Only if there are ANY events in this week */}
        {events.length > 0 && (
          <div className={styles.dividerLine}>
            <span className={styles.dividerLabel}>오후 12:00</span>
          </div>
        )}

        {/* 4. PM Events Row (Row 4) */}
        {days.map((date, index) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;

          const dayEvents = getEventsForDate(date);

          // PM Logic:
          // 1. Spanning PM (Starts < 12 AND Ends >= 12) -> Top (near divider)
          // 2. Normal PM (Starts >= 12) -> Bottom
          const normalPmEvents: Event[] = [];
          const spanningPmEvents: Event[] = [];

          dayEvents.forEach(event => {
            if (!event.startTime) return;

            if (event.startTime >= '12:00') {
              // Started in PM -> Normal PM
              normalPmEvents.push(event);
            } else {
              // Started in AM
              if (event.endTime && event.endTime > '12:00') {
                // Spanning Event (PM View) - Only if it goes PAST 12:00
                spanningPmEvents.push(event);
              }
            }
          });

          // Sort by End Time ASC (as requested)
          const sortByEndTime = (a: Event, b: Event) => {
            const endA = a.endTime || a.startTime || '';
            const endB = b.endTime || b.startTime || '';
            return endA.localeCompare(endB);
          };

          normalPmEvents.sort(sortByEndTime);
          spanningPmEvents.sort(sortByEndTime);

          return (
            <div
              key={`pm-${dateStr}`}
              className={`${styles.pmEvents} ${index === 6 ? styles.lastColumn : ''}`}
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest('[data-event-item]')) return;
                onDateClick(dateStr, e.currentTarget, 'pm');
              }}
              onMouseEnter={() => setHoveredDate(dateStr)}
              onMouseLeave={() => setHoveredDate(null)}
            >
              <div className={styles.eventsList}>
                {/* 1. Spanning PM Events (Top - Near Divider) */}
                {spanningPmEvents.map(event => (
                  <EventItem
                    key={`${event.id}-pm`}
                    event={event}
                    onEventDoubleClick={onEventDoubleClick}
                    onDeleteEvent={onDeleteEvent}
                    timeDisplay="end-only"
                    hideDeleteButton={true}
                  />
                ))}

                {/* 2. Normal PM Events (Bottom) */}
                {normalPmEvents.map(event => (
                  <EventItem
                    key={event.id}
                    event={event}
                    onEventDoubleClick={onEventDoubleClick}
                    onDeleteEvent={onDeleteEvent}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* 5. Routine Row (Row 5 - Optional) */}
        {showRoutines && days.map((date, index) => {
          const routineDayIndex = weekOrder === 'sun' ? (index === 0 ? 6 : index - 1) : index;
          const dayRoutines = getRoutinesForDay(routineDayIndex);
          const visibleRoutines = dayRoutines.filter(r => shouldShowRoutine(r, date));

          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;

          const shouldShowDiaryRoutine = true;

          return (
            <div key={`routine-${dateStr}`} className={`${styles.dayRoutineCell} ${index === 6 ? styles.lastColumn : ''}`}>
              {visibleRoutines.map(routine => {
                const completed = isRoutineCompleted(routine.id, dateStr);
                return (
                  <div key={routine.id} className={styles.dayRoutineItem}>
                    <RoutineIcon
                      routine={routine}
                      completed={completed}
                      enabled={true}
                      onClick={() => onToggleRoutine(routine.id, dateStr)}
                    />
                  </div>
                );
              })}
              {shouldShowDiaryRoutine && (
                <div
                  className={`${styles.dayRoutineItem} ${styles.dayRoutineDiary} ${diaryCompletions[dateStr] ? styles.dayRoutineDiaryCompleted : styles.dayRoutineDiaryHidden
                    }`}
                >
                  <RoutineIcon
                    routine={DIARY_ROUTINE}
                    completed={Boolean(diaryCompletions[dateStr])}
                    enabled={true}
                    onClick={() => onOpenDiary(dateStr)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 투두 리스트 */}
      {showTodos && (
        <TodoList
          todos={todos}
          onAdd={(text, deadline) => onAddTodo(todoWeekStart, text, deadline)}
          onToggle={onToggleTodo}
          onUpdate={onUpdateTodo}
          onDelete={onDeleteTodo}
          onReorder={(newTodos) => onReorderTodos(todoWeekStart, newTodos)}
        />
      )}
    </div>
  );
});