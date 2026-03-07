import { describe, it, expect } from 'vitest';
import {
  isCalDAVAuthErrorMessage,
  isCalDAVSyncTarget,
  isSubscriptionLikeCalendar,
  isWritableCalendar,
  normalizeSelectedCalDAVUrlSet,
  getCalDAVSyncTargets,
  buildCalDAVConfigFromSettings,
} from './calendarSyncUtils';
import type { CalendarMetadata } from './api';

const makeCalendar = (overrides: Partial<CalendarMetadata> = {}): CalendarMetadata => ({
  url: 'https://caldav.icloud.com/user/calendars/work',
  displayName: 'Work',
  color: '#3b82f6',
  ...overrides,
});

describe('calendarSyncUtils', () => {
  it('CalDAV 인증 에러 문구를 감지한다', () => {
    expect(isCalDAVAuthErrorMessage('애플 계정 인증에 실패')).toBe(true);
    expect(isCalDAVAuthErrorMessage('인증에 실패했습니다')).toBe(true);
    expect(isCalDAVAuthErrorMessage('network timeout')).toBe(false);
  });

  it('CalDAV 동기화 대상 캘린더를 올바르게 판별한다', () => {
    expect(isCalDAVSyncTarget(makeCalendar())).toBe(true);
    expect(isCalDAVSyncTarget(makeCalendar({ url: 'local-123' }))).toBe(false);
    expect(isCalDAVSyncTarget(makeCalendar({ type: 'subscription' }))).toBe(false);
    expect(isCalDAVSyncTarget(makeCalendar({ isSubscription: true }))).toBe(false);
    expect(isCalDAVSyncTarget(makeCalendar({ url: 'https://example.com/holiday.ics' }))).toBe(false);
  });

  it('구독/읽기전용 판별이 기대대로 동작한다', () => {
    expect(isSubscriptionLikeCalendar(makeCalendar({ type: 'subscription' }))).toBe(true);
    expect(isSubscriptionLikeCalendar(makeCalendar({ url: 'https://foo/holidays/kr_ko.ics' }))).toBe(true);
    expect(isSubscriptionLikeCalendar(makeCalendar())).toBe(false);

    expect(isWritableCalendar(makeCalendar())).toBe(true);
    expect(isWritableCalendar(makeCalendar({ readOnly: true }))).toBe(false);
    expect(isWritableCalendar(makeCalendar({ isSubscription: true }))).toBe(false);
  });

  it('선택된 URL 정규화와 대상 필터가 trailing slash를 무시한다', () => {
    const calendars = [
      makeCalendar({ url: 'https://caldav.icloud.com/a/work/' }),
      makeCalendar({ url: 'https://caldav.icloud.com/a/home' }),
      makeCalendar({ url: 'https://example.com/sub.ics' }),
    ];

    const selectedSet = normalizeSelectedCalDAVUrlSet(['https://caldav.icloud.com/a/work']);
    expect(selectedSet.has('https://caldav.icloud.com/a/work')).toBe(true);

    const targets = getCalDAVSyncTargets(calendars, ['https://caldav.icloud.com/a/work']);
    expect(targets).toHaveLength(1);
    expect(targets[0].url).toBe('https://caldav.icloud.com/a/work/');
  });

  it('CalDAV 설정을 Config로 변환할 때 null id는 undefined 처리한다', () => {
    const config = buildCalDAVConfigFromSettings({
      serverUrl: 'https://caldav.icloud.com',
      username: 'user@icloud.com',
      password: 'app-password',
      id: null,
    });

    expect(config.serverUrl).toBe('https://caldav.icloud.com');
    expect(config.username).toBe('user@icloud.com');
    expect(config.password).toBe('app-password');
    expect(config.settingId).toBeUndefined();
  });
});
