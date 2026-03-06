import { describe, it, expect, vi } from 'vitest';
import { mapGoogleEventToRiff, GoogleEvent } from './googleCalendar';

// googleCalendar.ts는 supabase를 최상위에서 import하므로 모킹 필요
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

// ─────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────

const makeTimedEvent = (overrides: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id: 'google-event-id-1',
  summary: '팀 미팅',
  description: '주간 회의',
  start: { dateTime: '2024-03-11T10:00:00+09:00' },
  end:   { dateTime: '2024-03-11T11:00:00+09:00' },
  status: 'confirmed',
  etag: '"abc123"',
  ...overrides,
});

const makeAllDayEvent = (overrides: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id: 'google-allday-id-1',
  summary: '종일 이벤트',
  start: { date: '2024-03-11' },
  end:   { date: '2024-03-12' }, // Google: 종료일은 exclusive
  status: 'confirmed',
  ...overrides,
});

const makeMultiDayEvent = (): GoogleEvent => ({
  id: 'google-multiday-id-1',
  summary: '다일 이벤트',
  start: { date: '2024-03-11' },
  end:   { date: '2024-03-14' }, // exclusive → 실제 마지막 날 = 03-13
  status: 'confirmed',
});

describe('mapGoogleEventToRiff', () => {
  const CAL_ID = 'primary';
  const COLOR = '#4285F4';

  // ─── cancelled 처리 ───────────────────────────────────────────

  describe('cancelled 이벤트', () => {
    it('status가 cancelled이면 null을 반환한다', () => {
      const event = makeTimedEvent({ status: 'cancelled' });
      expect(mapGoogleEventToRiff(event, CAL_ID, COLOR)).toBeNull();
    });

    it('status가 없어도 null을 반환하지 않는다 (confirmed으로 처리)', () => {
      const event = makeTimedEvent({ status: undefined });
      expect(mapGoogleEventToRiff(event, CAL_ID, COLOR)).not.toBeNull();
    });
  });

  // ─── 기본 필드 매핑 ───────────────────────────────────────────

  describe('시간 지정 이벤트 (timed event)', () => {
    it('필수 필드가 올바르게 매핑된다', () => {
      const result = mapGoogleEventToRiff(makeTimedEvent(), CAL_ID, COLOR);
      expect(result).not.toBeNull();
      expect(result!.title).toBe('팀 미팅');
      expect(result!.memo).toBe('주간 회의');
      expect(result!.date).toBe('2024-03-11');
      expect(result!.startTime).toBe('10:00');
      expect(result!.endTime).toBe('11:00');
      expect(result!.color).toBe(COLOR);
      expect(result!.source).toBe('google');
    });

    it('calendarUrl은 google:<calendarId> 형식이다', () => {
      const result = mapGoogleEventToRiff(makeTimedEvent(), 'work@example.com', COLOR);
      expect(result!.calendarUrl).toBe('google:work@example.com');
    });

    it('caldavUid는 Google 이벤트 id를 재사용한다', () => {
      const result = mapGoogleEventToRiff(makeTimedEvent(), CAL_ID, COLOR);
      expect(result!.caldavUid).toBe('google-event-id-1');
    });

    it('etag가 그대로 전달된다', () => {
      const result = mapGoogleEventToRiff(makeTimedEvent(), CAL_ID, COLOR);
      expect(result!.etag).toBe('"abc123"');
    });

    it('summary가 없으면 제목 없음으로 처리된다', () => {
      const event = makeTimedEvent({ summary: undefined });
      const result = mapGoogleEventToRiff(event, CAL_ID, COLOR);
      expect(result!.title).toBe('(제목 없음)');
    });

    it('단일 날 이벤트는 endDate가 undefined다', () => {
      const result = mapGoogleEventToRiff(makeTimedEvent(), CAL_ID, COLOR);
      expect(result!.endDate).toBeUndefined();
    });
  });

  // ─── 종일 이벤트 ─────────────────────────────────────────────

  describe('종일 이벤트 (all-day event)', () => {
    it('startTime, endTime이 undefined다', () => {
      const result = mapGoogleEventToRiff(makeAllDayEvent(), CAL_ID, COLOR);
      expect(result!.startTime).toBeUndefined();
      expect(result!.endTime).toBeUndefined();
    });

    it('date는 start.date를 그대로 사용한다', () => {
      const result = mapGoogleEventToRiff(makeAllDayEvent(), CAL_ID, COLOR);
      expect(result!.date).toBe('2024-03-11');
    });

    it('Google의 exclusive 종료일이 하루 빼진 값으로 저장된다', () => {
      // Google end: 03-12 (exclusive) → Riff: 03-11과 같으므로 endDate=undefined
      const result = mapGoogleEventToRiff(makeAllDayEvent(), CAL_ID, COLOR);
      expect(result!.endDate).toBeUndefined();
    });
  });

  // ─── 다일 이벤트 ─────────────────────────────────────────────

  describe('다일 이벤트 (multi-day event)', () => {
    it('endDate가 올바르게 계산된다 (Google exclusive → -1일)', () => {
      // Google end: 03-14 (exclusive) → 실제 마지막 날 = 03-13
      const result = mapGoogleEventToRiff(makeMultiDayEvent(), CAL_ID, COLOR);
      expect(result!.date).toBe('2024-03-11');
      expect(result!.endDate).toBe('2024-03-13');
    });
  });
});
