import { useMemo } from 'react';
import { Event } from '../types';

export interface VisualAllDayEvent {
  id: string;
  title: string;
  color: string;
  event: Event;
  startIdx: number;
  span: number;
  track: number;
}

interface AllDayEventLayoutResult {
  visibleAllDayEvents: VisualAllDayEvent[];
  multiDayEventKeys: Set<string>;
}

/**
 * All-Day 및 Multi-Day 이벤트의 레이아웃을 계산하는 훅
 * 
 * 이 훅은 다음 작업을 수행합니다:
 * 1. 이벤트들을 그룹화하여 연속된 다중일 이벤트 식별
 * 2. 다중일 이벤트를 트랙(행)에 배치
 * 3. 남은 공간에 단일일 종일 이벤트 배치
 * 
 * @param events - 주간의 모든 이벤트
 * @param weekStart - 주의 시작 날짜
 * @returns 시각화할 All-Day 이벤트 목록과 처리된 이벤트 ID Set
 */
export function useAllDayEventLayout(
  events: Event[],
  weekStart: Date
): AllDayEventLayoutResult {
  return useMemo(() => {
    // 1. Group ALL events to find multi-day sequences
    const groups = new Map<string, Event[]>();
    events.forEach(e => {
      const key = e.caldavUid || `${e.title}|${e.color}|${e.isLocal}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    });

    const multiDayFeatures: VisualAllDayEvent[] = [];
    const multiDayKeys = new Set<string>();
    const singleDayCandidates: Event[] = [];

    const parseYMD = (str: string) => {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d);
    };

    const getDayIndex = (dLocal: Date) => {
      const startLocal = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
      const diffTime = dLocal.getTime() - startLocal.getTime();
      return Math.round(diffTime / (1000 * 60 * 60 * 24));
    };

    // Phase 1: Identify Multi-Day Events vs Single-Day Events
    groups.forEach(group => {
      group.sort((a, b) => a.date.localeCompare(b.date));

      let chunk: Event[] = [];
      const flushChunk = () => {
        if (chunk.length === 0) return;

        const first = chunk[0];
        const last = chunk[chunk.length - 1];
        const firstDate = parseYMD(first.date);
        const lastDateStr = last.endDate || last.date;
        const lastDate = parseYMD(lastDateStr);

        const sIdx = getDayIndex(firstDate);
        const eIdx = getDayIndex(lastDate);

        if (eIdx < 0 || sIdx > 6) return; // Outside

        const effectiveStart = Math.max(0, sIdx);
        const effectiveEnd = Math.min(6, eIdx);
        const span = effectiveEnd - effectiveStart + 1;

        const isMultiDay = chunk.length > 1 || first.date !== lastDateStr;

        if (isMultiDay && span > 0) {
          multiDayFeatures.push({
            id: first.id,
            title: first.title,
            color: first.color,
            event: first,
            startIdx: effectiveStart,
            span,
            track: 0 // Will be assigned later
          });
          chunk.forEach(e => multiDayKeys.add(e.id));
        } else if (!first.startTime && span > 0) {
          // Single-Day All-Day Candidate
          singleDayCandidates.push(first);
        }
      };

      group.forEach((ev, i) => {
        if (i === 0) { chunk.push(ev); return; }
        const prev = chunk[chunk.length - 1];
        const d1 = parseYMD(prev.date);
        const d2 = parseYMD(ev.date);
        const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));

        if (diff === 1) {
          chunk.push(ev);
        } else {
          flushChunk();
          chunk = [ev];
        }
      });
      flushChunk();
    });

    // Phase 2: Sort Multi-Day Events (Longer span first)
    multiDayFeatures.sort((a, b) => {
      if (a.span !== b.span) return b.span - a.span;
      if (a.startIdx !== b.startIdx) return a.startIdx - b.startIdx;
      return a.title.localeCompare(b.title);
    });

    // Phase 3: Place Multi-Day Events on Tracks
    const tracks: boolean[][] = [];

    // Track placement helper
    const canPlace = (t: number, start: number, span: number) => {
      if (!tracks[t]) return true;
      for (let i = 0; i < span; i++) {
        if (tracks[t][start + i]) return false;
      }
      return true;
    };

    const place = (t: number, start: number, span: number) => {
      if (!tracks[t]) tracks[t] = [];
      for (let i = 0; i < span; i++) tracks[t][start + i] = true;
    };

    multiDayFeatures.forEach(ve => {
      let t = 0;
      while (true) {
        if (canPlace(t, ve.startIdx, ve.span)) {
          place(t, ve.startIdx, ve.span);
          ve.track = t;
          break;
        }
        t++;
      }
    });

    // Phase 4: Try to fill gaps with Single-Day All-Day Events
    const existingMaxTrack = tracks.length - 1;

    if (existingMaxTrack >= 0) {
      singleDayCandidates.forEach(ev => {
        const dayIdx = getDayIndex(parseYMD(ev.date));
        if (dayIdx >= 0 && dayIdx <= 6) {
          // Try to find a spot within EXISTING tracks
          for (let t = 0; t <= existingMaxTrack; t++) {
            if (canPlace(t, dayIdx, 1)) {
              place(t, dayIdx, 1);

              multiDayFeatures.push({
                id: ev.id,
                title: ev.title,
                color: ev.color,
                event: ev,
                startIdx: dayIdx,
                span: 1,
                track: t
              });

              multiDayKeys.add(ev.id);
              break;
            }
          }
        }
      });
    }

    return { visibleAllDayEvents: multiDayFeatures, multiDayEventKeys: multiDayKeys };
  }, [events, weekStart]);
}
