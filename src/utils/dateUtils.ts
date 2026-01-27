import { WeekOrder } from '../types';

export const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getWeekStartForDate = (date: Date, weekOrder: WeekOrder): Date => {
  const weekStart = new Date(date);
  const dayOfWeek = weekStart.getDay();
  const diff = weekOrder === 'sun'
    ? -dayOfWeek
    : (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
  weekStart.setDate(weekStart.getDate() + diff);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
};

export const getTodoWeekStart = (weekStart: Date, weekOrder: WeekOrder): string => {
  const base = new Date(weekStart);
  if (weekOrder === 'sun') {
    base.setDate(base.getDate() + 1);
  }
  return formatLocalDate(base);
};

export const getWeekRangeString = (weekStart: Date): string => {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const startMonth = weekStart.getMonth() + 1;
  const startDay = weekStart.getDate();
  const endMonth = weekEnd.getMonth() + 1;
  const endDay = weekEnd.getDate();

  // 같은 달이면 "1월 1일 - 7일"
  if (startMonth === endMonth) {
    return `${startMonth}월 ${startDay}일 - ${endDay}일`;
  }
  // 다른 달이면 "1월 28일 - 2월 3일"
  return `${startMonth}월 ${startDay}일 - ${endMonth}월 ${endDay}일`;
};
