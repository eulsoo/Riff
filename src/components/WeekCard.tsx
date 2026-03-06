import { memo, useState, useMemo } from 'react';
import { EventItem } from './EventItem';
import { Event, Routine, RoutineCompletion, Todo, WeekOrder } from '../types';
import { RoutineIcon } from './RoutineIcon';
import { TodoList } from './TodoList';
import { useData } from '../contexts/DataContext';
import { useHover, useSelection } from '../contexts/SelectionContext';
import { useDrag, addDays } from '../contexts/DragContext';
import { useAllDayEventLayout } from '../hooks/useAllDayEventLayout';
import { buildEventsByDate, formatDateKey } from '../lib/eventLayout';
import styles from './WeekCard.module.css';

interface WeekCardProps {
  weekStart: Date;
  todoWeekStart: string; // Key for todo lookup (may differ from weekStart for sun-start weeks)
  events: Event[];
  routines: Routine[];
  routineCompletions: RoutineCompletion[];
  todos: Todo[];
  weekOrder: WeekOrder;
  onDateClick: (date: string, anchorEl?: HTMLElement, timeSlot?: 'am' | 'pm' | 'allday') => void;
  onEventDoubleClick: (event: Event, anchorEl?: HTMLElement) => void;
  onDeleteEvent: (eventId: string) => void;
  onToggleRoutine: (routineId: string, date: string) => void;
  onAddTodo: (weekStart: string, text: string, deadline?: string) => void;
  onToggleTodo: (todoId: string) => void;
  onUpdateTodo: (todoId: string, text: string, deadline?: string) => void;
  onDeleteTodo: (todoId: string) => void;
  onReorderTodos: (weekStart: string, newTodos: Todo[]) => void;
  onOpenDiary: (date: string) => void;
  onOpenEmotion?: (date: string, anchorEl: HTMLElement) => void;
  diaryCompletions: Record<string, boolean>;
  weekStatus: 'current' | 'prev' | 'next' | 'other';
  showRoutines: boolean;
  showDiary: boolean;
  showEmotion: boolean;
  showTodos: boolean;
}

const DIARY_ROUTINE: Routine = {
  id: 'diary',
  name: '글쓰기',
  icon: 'edit',
  color: '#8b5cf6',
  days: [],
};

const EMOTION_ROUTINE: Routine = {
  id: 'emotion',
  name: '감정남기기',
  icon: 'sentiment_calm',
  color: '#f59e0b',
  days: [],
};

const getFirstLine = (html: string) => {
  if (!html) return '';
  const textWithNewlines = html.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  const lines = textWithNewlines.split('\n')
    .map(line => line.replace(/&nbsp;/g, ' ').trim())
    .filter(Boolean);
  return lines[0] || '';
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
  onOpenEmotion,
  diaryCompletions,
  weekStatus,
  showRoutines,
  showDiary,
  showEmotion,
  showTodos,
}: WeekCardProps) {
  const [isAddingEmptyTodo, setIsAddingEmptyTodo] = useState(false);
  const { setHoveredDate } = useHover();
  const { activeDate, setActiveDate, setActiveTimeSlot } = useSelection();
  const { dragState, dragOverDate, setDragOverDate, dragStateRef } = useDrag();
  const { emotions, diaryEntries } = useData();

  // 구독/읽기전용 이벤트 여부 판별 (드래그 차단에 사용)
  const isEventReadOnly = (event: Event): boolean => {
    if (!event.calendarUrl) return false;
    const url = event.calendarUrl;
    return url.endsWith('.ics') || url.includes('holidays') || url.includes('subscription');
  };
  // Performance Monitoring

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    return date;
  });

  // --- All-Day Events Logic (extracted to hook) ---
  const { visibleAllDayEvents, multiDayEventKeys } = useAllDayEventLayout(events, weekStart);



  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  // 렌더당 14회 반복 filter 제거: events 배열 변경 시만 맵 재계산
  const eventsByDate = useMemo(
    () => buildEventsByDate(events, multiDayEventKeys),
    [events, multiDayEventKeys]
  );

  const getEventsForDate = (date: Date) => eventsByDate[formatDateKey(date)] ?? [];

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

    // 3. Deletion check
    if (routine.deletedAt) {
      const deletedDate = new Date(routine.deletedAt);
      const dYear = deletedDate.getFullYear();
      const dMonth = String(deletedDate.getMonth() + 1).padStart(2, '0');
      const dDay = String(deletedDate.getDate()).padStart(2, '0');
      const deletedDateStr = `${dYear}-${dMonth}-${dDay}`;

      deletedDate.setHours(0, 0, 0, 0);

      if (checkDate > deletedDate) return false;
      if (checkDate.getTime() === deletedDate.getTime()) {
        const isCompletedOnDeletedDate = routineCompletions.some(
          rc => rc.routineId === routine.id && rc.date === deletedDateStr && rc.completed
        );
        if (!isCompletedOnDeletedDate) return false;
      }
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

          const shouldShowEmotionRoutine = true;
          const shouldShowDiaryRoutine = true;
          const currentEmotion = emotions[dateStr];
          const hasDiary = Boolean(diaryCompletions[dateStr]);
          const currentDiaryEntry = diaryEntries[dateStr];

          const sortedSpecialRoutines = [
            { type: 'emotion' as const, completed: !!currentEmotion, show: shouldShowEmotionRoutine && showEmotion },
            { type: 'diary' as const, completed: hasDiary, show: shouldShowDiaryRoutine && showDiary }
          ]
            .filter(r => r.show)
            .sort((a, b) => {
              if (a.completed && !b.completed) return -1;
              if (!a.completed && b.completed) return 1;
              return 0;
            });

          return (
            <div
              key={`header-${dateStr}`}
              className={`${styles.dayHeader} ${index === 6 ? styles.lastColumn : ''}`}
              onMouseEnter={() => setHoveredDate(dateStr)}
              onMouseLeave={() => setHoveredDate(null)}
            >
              {/* Spacer removed, using flex in child */}

              <div className={styles.headerSpecials}>
                {sortedSpecialRoutines.map(item => {
                  if (item.type === 'emotion') {
                    return (
                      <div
                        key="emotion"
                        className={`${styles.headerMetaItem} ${currentEmotion ? styles.headerMetaItemCompleted : styles.headerMetaItemHidden}`}
                      >
                        <button
                          onClick={(e) => onOpenEmotion?.(dateStr, e.currentTarget)}
                          className={`${styles.emotionIconButton} ${currentEmotion ? styles.emotionIconCompleted : styles.emotionIconIncomplete}`}
                          style={{ backgroundColor: 'transparent', color: currentEmotion ? '#f59e0b' : '#d1d5db' }}
                          title={currentEmotion ? '기분 남기기' : '기분 남기기'}
                        >
                          {!currentEmotion ? (
                            <span className="material-symbols-rounded" style={{ fontSize: '20px', fontWeight: 500, fontVariationSettings: `'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24` }}>
                              {EMOTION_ROUTINE.icon}
                            </span>
                          ) : (
                            <span style={{ fontSize: '20px', lineHeight: 1 }}>{currentEmotion}</span>
                          )}
                        </button>
                      </div>
                    );
                  } else if (item.type === 'diary') {
                    const diaryText = currentDiaryEntry?.title || getFirstLine(currentDiaryEntry?.content || '') || '';
                    return (
                      <div
                        key="diary"
                        className={`${styles.headerMetaItem} ${hasDiary ? styles.headerMetaItemCompleted : styles.headerMetaItemHidden}`}
                        style={hasDiary ? { flex: 1, minWidth: 0 } : undefined}
                      >
                        {hasDiary ? (
                          <div
                            className={styles.headerDiaryText}
                            onClick={() => onOpenDiary(dateStr)}
                          >
                            {diaryText || '글쓰기'}
                          </div>
                        ) : (
                          <button
                            onClick={() => onOpenDiary(dateStr)}
                            className={`${styles.emotionIconButton} ${styles.emotionIconIncomplete}`}
                            style={{ backgroundColor: 'transparent', color: '#d1d5db' }}
                            title="글쓰기"
                          >
                            <span className="material-symbols-rounded" style={{ fontSize: '20px', fontWeight: 500, fontVariationSettings: `'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24` }}>
                              {DIARY_ROUTINE.icon}
                            </span>
                          </button>
                        )}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>

              <div
                className={`${styles.dayMeta} ${today ? styles.dayMetaToday : ''}`}
                data-date-allday={dateStr}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('[data-event-item]')) return;
                  if (activeDate === dateStr) {
                    setActiveDate(null);
                    setActiveTimeSlot(null);
                  } else {
                    setActiveDate(dateStr);
                    setActiveTimeSlot('allday');
                  }
                }}
              >
                <span
                  className={`${styles.dayName} ${isWeekend ? styles.dayNameWeekend : styles.dayNameWeekday
                    } ${dateStr === activeDate && !today ? styles.dayNameSelected : ''
                    } ${dateStr === activeDate && today ? styles.dayNameSelectedToday : ''}`}
                >
                  {dayNames[index]}
                </span>
                <div
                  className={`${styles.dayNumber} ${today
                    ? styles.dayNumberToday
                    : isWeekend
                      ? styles.dayNumberWeekend
                      : styles.dayNumberWeekday
                    } ${dateStr === activeDate && !today ? styles.dayNumberSelected : ''
                    } ${dateStr === activeDate && today ? styles.dayNumberSelectedToday : ''}`}
                >
                  {date.getDate()}
                </div>
              </div>
            </div>
          );
        })}



        {/* 1.5 All-Day Events Row (Row 2) */}
        {(() => {
          // 드래그 중인 다중일(하루종일) 이벤트의 미리보기 계산
          let dragPreviewStartIdx = -1;
          let dragPreviewSpan = 0;

          if (dragState && !dragState.draggingEvent.startTime && dragOverDate) {
            const overIdx = days.findIndex(d => {
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const dd = String(d.getDate()).padStart(2, '0');
              return `${y}-${m}-${dd}` === dragOverDate;
            });
            if (overIdx >= 0) {
              dragPreviewStartIdx = overIdx;
              // 원본 기간(durationDays+1칸) 그대로, 주간 끝에서 잘림
              dragPreviewSpan = Math.min(dragState.durationDays + 1, 7 - overIdx);
            }
          }

          const hasContent = visibleAllDayEvents.length > 0 || dragPreviewStartIdx >= 0;
          if (!hasContent) return null;

          return (
            <div className={styles.allDayRow} style={{ gridRow: 2 }}>
              <div className={styles.allDayRowBackground}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className={styles.allDayRowCol} />
                ))}
              </div>

              {/* 실제 다중일/하루종일 이벤트 */}
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
                    isDragging={dragState?.draggingEvent.id === ve.event.id}
                    isReadOnly={isEventReadOnly(ve.event)}
                  />
                </div>
              ))}

              {/* 다중일 이벤트 드래그 미리보기 (원본 기간 너비) */}
              {dragPreviewStartIdx >= 0 && dragState && (
                <div
                  className={styles.allDayItemContainer}
                  style={{
                    gridColumnStart: dragPreviewStartIdx + 1,
                    gridColumnEnd: dragPreviewStartIdx + 1 + dragPreviewSpan,
                    gridRow: 1,
                    pointerEvents: 'none',
                    opacity: 0.75,
                  }}
                >
                  <EventItem
                    event={{
                      ...dragState.draggingEvent,
                      date: dragOverDate!,
                      endDate: addDays(dragOverDate!, dragState.durationDays),
                    }}
                    variant="compact"
                    onEventDoubleClick={() => { }}
                    onDeleteEvent={() => { }}
                    isDragPreview={true}
                  />
                </div>
              )}
            </div>
          );
        })()}

        {/* 2. AM Events Row (Row 3) */}
        {(() => {
          // Check if ANY day in the current week has an AM-PM spanning event
          const hasAnySpanningEventInWeek = days.some(date => {
            const dayEvents = getEventsForDate(date);
            return dayEvents.some(event => {
              if (event.startTime && event.endTime) {
                return event.startTime < '12:00' && event.endTime > '12:00';
              }
              return false;
            });
          });

          return days.map((date, index) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

            const dayEvents = getEventsForDate(date);

            // Split into two groups:
            // 1. All-Day events (no startTime) - always at TOP
            // 2. Timed AM events (startTime < 12:00) - at BOTTOM (near divider if ANY spanning event exists in this week)
            const allDayEvents = dayEvents.filter(e => !e.startTime);
            const timedAmEvents = dayEvents.filter(e => {
              if (!e.startTime) return false;
              const startHour = parseInt(e.startTime.split(':')[0]);
              return startHour < 12;
            });

            // Sort timed events by start time
            timedAmEvents.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

            return (
              <div
                key={`am-${dateStr}`}
                data-date-am={dateStr}
                className={`${styles.amEvents} ${index === 6 ? styles.lastColumn : ''}`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('[data-event-item]')) return;
                  if (activeDate === dateStr) {
                    setActiveDate(null);
                    setActiveTimeSlot(null);
                  } else {
                    setActiveDate(dateStr);
                    setActiveTimeSlot('am');
                  }
                }}
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest('[data-event-item]')) return;
                  onDateClick(dateStr, e.currentTarget, 'am');
                }}
                onMouseEnter={() => {
                  setHoveredDate(dateStr);
                  if (dragStateRef.current) setDragOverDate(dateStr);
                }}
                onMouseLeave={() => setHoveredDate(null)}
              >
                {/* Group 1: All-Day Events - Always at TOP */}
                {(allDayEvents.length > 0 || (dragState && dragOverDate === dateStr && !dragState.draggingEvent.startTime)) && (
                  <div className={styles.eventsList} style={{ justifyContent: 'flex-start' }}>
                    {allDayEvents.map(event => (
                      <EventItem
                        key={event.id}
                        event={event}
                        onEventDoubleClick={onEventDoubleClick}
                        onDeleteEvent={onDeleteEvent}
                        variant="compact"
                        className={styles.allday}
                        isDragging={dragState?.draggingEvent.id === event.id}
                        isReadOnly={isEventReadOnly(event)}
                      />
                    ))}
                  </div>
                )}

                {/* Group 2: Timed AM Events - At BOTTOM if spanning exists in the week, otherwise after all-day */}
                {timedAmEvents.length > 0 && (
                  <div
                    className={styles.eventsList}
                    style={{
                      justifyContent: hasAnySpanningEventInWeek ? 'flex-end' : 'flex-start',
                      flex: hasAnySpanningEventInWeek ? 1 : 'none'
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
                          isDragging={dragState?.draggingEvent.id === event.id}
                          isReadOnly={isEventReadOnly(event)}
                        />
                      );
                    })}
                  </div>
                )}

                {/* 드래그 미리보기: dragOverDate가 이 날짜이고 원본이 am 이벤트일 때 */}
                {dragState && dragOverDate === dateStr && (() => {
                  const orig = dragState.draggingEvent;
                  if (!orig.startTime) return null; // 하루종일 이벤트는 별도 처리
                  const startHour = parseInt(orig.startTime.split(':')[0]);
                  if (startHour < 12) {
                    const isSpanning = orig.endTime && orig.endTime > '12:00';
                    const previewEvent = { ...orig, date: dateStr, endDate: addDays(dateStr, dragState.durationDays) };
                    return (
                      <div className={styles.eventsList} style={{ justifyContent: hasAnySpanningEventInWeek ? 'flex-end' : 'flex-start' }}>
                        <EventItem
                          key="drag-preview-am"
                          event={previewEvent}
                          onEventDoubleClick={() => { }}
                          onDeleteEvent={() => { }}
                          // 오전~오후 걸친 이벤트는 AM 뷰에서 시작 시간만 표시
                          timeDisplay={isSpanning ? 'start-only' : 'default'}
                          isDragPreview={true}
                        />
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            );
          })
        })()}

        {/* 3. Divider Line (Row 3) - Only if there are ANY events in this week */}
        {events.length > 0 && (
          <div className={styles.dividerLine}>
            <span className={styles.dividerLabel}>오후</span>
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
              data-date-pm={dateStr}
              className={`${styles.pmEvents} ${index === 6 ? styles.lastColumn : ''}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('[data-event-item]')) return;
                if (activeDate === dateStr) {
                  setActiveDate(null);
                  setActiveTimeSlot(null);
                } else {
                  setActiveDate(dateStr);
                  setActiveTimeSlot('pm');
                }
              }}
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest('[data-event-item]')) return;
                onDateClick(dateStr, e.currentTarget, 'pm');
              }}
              onMouseEnter={() => {
                setHoveredDate(dateStr);
                if (dragStateRef.current) setDragOverDate(dateStr);
              }}
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
                    isReadOnly={isEventReadOnly(event)}
                  />
                ))}

                {/* 2. Normal PM Events (Bottom) */}
                {normalPmEvents.map(event => (
                  <EventItem
                    key={event.id}
                    event={event}
                    onEventDoubleClick={onEventDoubleClick}
                    onDeleteEvent={onDeleteEvent}
                    isDragging={dragState?.draggingEvent.id === event.id}
                    isReadOnly={isEventReadOnly(event)}
                  />
                ))}

                {/* 드래그 미리보기: pm 이벤트 또는 오전~오후 걸친 이벤트가 이 날짜로 진입할 때 */}
                {dragState && dragOverDate === dateStr && (() => {
                  const orig = dragState.draggingEvent;
                  if (!orig.startTime) return null; // 하루종일은 allDayRow에서 처리
                  const startHour = parseInt(orig.startTime.split(':')[0]);
                  const isSpanning = startHour < 12 && orig.endTime && orig.endTime > '12:00';
                  const isPm = startHour >= 12;

                  if (isPm || isSpanning) {
                    const previewEvent = { ...orig, date: dateStr, endDate: addDays(dateStr, dragState.durationDays) };
                    return (
                      <EventItem
                        key="drag-preview-pm"
                        event={previewEvent}
                        onEventDoubleClick={() => { }}
                        onDeleteEvent={() => { }}
                        // 오전~오후 걸친 이벤트는 PM 뷰에서 시간 끝만 표시
                        timeDisplay={isSpanning ? 'end-only' : 'default'}
                        isDragPreview={true}
                      />
                    );
                  }
                  return null;
                })()}
              </div>
            </div>
          );
        })}

        {/* 5. Routine Row (Row 5 - Optional) */}
        {(() => {
          if (!showRoutines) return null;

          const hasAnyRoutinesInWeek = days.some((date, index) => {
            const routineDayIndex = weekOrder === 'sun' ? (index === 0 ? 6 : index - 1) : index;
            const dayRoutines = getRoutinesForDay(routineDayIndex);
            return dayRoutines.some(r => shouldShowRoutine(r, date));
          });

          if (!hasAnyRoutinesInWeek) return null;

          return days.map((date, index) => {
            const routineDayIndex = weekOrder === 'sun' ? (index === 0 ? 6 : index - 1) : index;
            const dayRoutines = getRoutinesForDay(routineDayIndex);
            const visibleRoutines = dayRoutines.filter(r => shouldShowRoutine(r, date));

            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

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
              </div>
            );
          });
        })()}
      </div>

      {/* 투두 리스트 */}
      {showTodos && (todos.length > 0 || isAddingEmptyTodo) && (
        <TodoList
          todos={todos}
          onAdd={(text, deadline) => {
            onAddTodo(todoWeekStart, text, deadline);
            setIsAddingEmptyTodo(false);
          }}
          onToggle={onToggleTodo}
          onUpdate={onUpdateTodo}
          onDelete={onDeleteTodo}
          onReorder={(newTodos) => onReorderTodos(todoWeekStart, newTodos)}
          forceAdding={isAddingEmptyTodo}
          onAddingCanceled={() => setIsAddingEmptyTodo(false)}
        />
      )}

      {showTodos && todos.length === 0 && !isAddingEmptyTodo && (
        <button
          className={styles.emptyTodoOverlayBtn}
          onClick={() => setIsAddingEmptyTodo(true)}
        >
          <span className={`material-symbols-rounded ${styles.emptyTodoIcon}`}>check_circle</span>
        </button>
      )}
    </div>
  );
});