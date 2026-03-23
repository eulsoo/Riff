
export interface Event {
  id: string;
  date: string;
  title: string;
  memo?: string;
  startTime?: string;
  endTime?: string;
  endDate?: string; // For multi-day events
  color: string;
  calendarUrl?: string;
  caldavUid?: string;
  source?: 'manual' | 'caldav' | 'google';
  isLocal?: boolean;
  etag?: string;
}

export interface Routine {
  id: string;
  name: string;
  icon: string;
  color: string;
  days: number[]; // 0=월, 1=화, 2=수, 3=목, 4=금, 5=토, 6=일
  createdAt?: string;
  deletedAt?: string;
}

export interface RoutineCompletion {
  routineId: string;
  date: string;
  completed: boolean;
}

export interface Todo {
  id: string;
  weekStart: string; // 주의 시작 날짜
  text: string;
  completed: boolean;
  deadline?: string;
  position?: number;
  isNew?: boolean;
}

export interface DiaryEntry {
  date: string;
  title: string;
  content: string;
  updatedAt?: string;
}

export interface EmotionEntry {
  date: string;
  emotion: string; // The selected emotion ID (formerly emoji string)
}

export type EmotionType = 'good' | 'curious' | 'normal' | 'sad' | 'angry' | string;

export interface EmotionItem {
  id: string;        // e.g. "em_emoji_good"
  type: EmotionType; // e.g. "good"
  imageUrl: string;  // e.g. "/images/em_emoji_good.png"
}

export interface EmotionSet {
  setId: string;     // e.g. "emoji"
  emotions: EmotionItem[];
}

export type WeekOrder = 'mon' | 'sun';
