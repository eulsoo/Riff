import { Event } from '../types';

/**
 * events 배열을 date 키로 그루핑한 맵을 반환합니다.
 * multiDayEventKeys에 포함된 이벤트(다일/종일 이벤트)는 제외됩니다.
 * (WeekCard의 All-Day Row에서 별도 렌더링하기 때문)
 */
export function buildEventsByDate(
  events: Event[],
  multiDayEventKeys: Set<string>
): Record<string, Event[]> {
  const map: Record<string, Event[]> = {};
  for (const event of events) {
    if (multiDayEventKeys.has(event.id)) continue;
    if (!map[event.date]) map[event.date] = [];
    map[event.date].push(event);
  }
  return map;
}

/**
 * Date 객체를 "YYYY-MM-DD" 형식의 문자열로 변환합니다.
 */
export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
