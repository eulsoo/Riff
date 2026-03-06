import { describe, it, expect } from 'vitest';
import { buildEventsByDate, formatDateKey } from './eventLayout';
import type { Event } from '../types';

const makeEvent = (overrides: Partial<Event> & { id: string; date: string }): Event => ({
  title: '테스트 이벤트',
  color: '#ff0000',
  ...overrides,
});

// ─────────────────────────────────────────────
// buildEventsByDate
// ─────────────────────────────────────────────
describe('buildEventsByDate', () => {
  it('날짜별로 이벤트를 올바르게 그루핑한다', () => {
    const events: Event[] = [
      makeEvent({ id: 'a', date: '2026-03-10' }),
      makeEvent({ id: 'b', date: '2026-03-11' }),
      makeEvent({ id: 'c', date: '2026-03-10' }),
    ];

    const result = buildEventsByDate(events, new Set());

    expect(result['2026-03-10']).toHaveLength(2);
    expect(result['2026-03-11']).toHaveLength(1);
    expect(result['2026-03-10'].map(e => e.id)).toEqual(['a', 'c']);
  });

  it('multiDayEventKeys에 포함된 이벤트는 맵에서 제외된다', () => {
    const events: Event[] = [
      makeEvent({ id: 'multi-1', date: '2026-03-10' }),
      makeEvent({ id: 'multi-2', date: '2026-03-11' }),
      makeEvent({ id: 'normal', date: '2026-03-10' }),
    ];
    const multiDayKeys = new Set(['multi-1', 'multi-2']);

    const result = buildEventsByDate(events, multiDayKeys);

    expect(result['2026-03-10']).toHaveLength(1);
    expect(result['2026-03-10'][0].id).toBe('normal');
    expect(result['2026-03-11']).toBeUndefined();
  });

  it('모든 이벤트가 multiDayEventKeys에 포함되면 빈 맵을 반환한다', () => {
    const events: Event[] = [
      makeEvent({ id: 'a', date: '2026-03-10' }),
      makeEvent({ id: 'b', date: '2026-03-11' }),
    ];
    const multiDayKeys = new Set(['a', 'b']);

    const result = buildEventsByDate(events, multiDayKeys);

    expect(Object.keys(result)).toHaveLength(0);
  });

  it('이벤트가 없으면 빈 맵을 반환한다', () => {
    const result = buildEventsByDate([], new Set());
    expect(result).toEqual({});
  });

  it('같은 날짜의 이벤트가 여러 개일 때 순서를 유지한다', () => {
    const events: Event[] = [
      makeEvent({ id: 'first', date: '2026-03-15', title: '첫번째' }),
      makeEvent({ id: 'second', date: '2026-03-15', title: '두번째' }),
      makeEvent({ id: 'third', date: '2026-03-15', title: '세번째' }),
    ];

    const result = buildEventsByDate(events, new Set());

    expect(result['2026-03-15'].map(e => e.id)).toEqual(['first', 'second', 'third']);
  });

  it('multiDayEventKeys가 일부만 포함할 때 나머지 날짜는 정상 포함된다', () => {
    const events: Event[] = [
      makeEvent({ id: 'span-mon', date: '2026-03-09' }),
      makeEvent({ id: 'span-tue', date: '2026-03-10' }),
      makeEvent({ id: 'regular', date: '2026-03-10' }),
    ];
    const multiDayKeys = new Set(['span-mon', 'span-tue']);

    const result = buildEventsByDate(events, multiDayKeys);

    expect(result['2026-03-09']).toBeUndefined();
    expect(result['2026-03-10']).toHaveLength(1);
    expect(result['2026-03-10'][0].id).toBe('regular');
  });
});

// ─────────────────────────────────────────────
// formatDateKey
// ─────────────────────────────────────────────
describe('formatDateKey', () => {
  it('Date 객체를 YYYY-MM-DD 형식으로 변환한다', () => {
    expect(formatDateKey(new Date(2026, 2, 11))).toBe('2026-03-11'); // 3월 → 인덱스 2
  });

  it('월과 일이 한 자리일 때 0을 앞에 붙인다', () => {
    expect(formatDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('연도 경계(12월 31일)를 올바르게 처리한다', () => {
    expect(formatDateKey(new Date(2025, 11, 31))).toBe('2025-12-31');
  });

  it('연도 경계(1월 1일)를 올바르게 처리한다', () => {
    expect(formatDateKey(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('buildEventsByDate의 date 키와 일치하는 문자열을 반환한다', () => {
    const dateStr = '2026-03-10';
    const events: Event[] = [makeEvent({ id: 'x', date: dateStr })];
    const map = buildEventsByDate(events, new Set());

    const key = formatDateKey(new Date(2026, 2, 10));
    expect(map[key]).toHaveLength(1);
    expect(map[key][0].id).toBe('x');
  });
});
