import { describe, it, expect } from 'vitest';
import { serializeMemo, parseMemo, META_ID } from './memoUtils';

// ─────────────────────────────────────────────────────────────
// serializeMemo
// ─────────────────────────────────────────────────────────────

describe('serializeMemo', () => {
  describe('메타데이터 없음', () => {
    it('memo만 있으면 그대로 반환한다', () => {
      expect(serializeMemo('오늘 회의', {})).toBe('오늘 회의');
    });

    it('memo가 undefined이면 빈 문자열을 반환한다', () => {
      expect(serializeMemo(undefined, {})).toBe('');
    });

    it('meta가 빈 객체면 META_ID를 포함하지 않는다', () => {
      expect(serializeMemo('메모', {})).not.toContain(META_ID);
    });
  });

  describe('메타데이터 있음', () => {
    it('endDate가 포함된 메타를 직렬화한다', () => {
      const result = serializeMemo('회의', { endDate: '2024-03-13' });
      expect(result).toContain('회의');
      expect(result).toContain(META_ID);
      expect(result).toContain('"endDate":"2024-03-13"');
    });

    it('memo가 undefined여도 메타를 직렬화한다', () => {
      const result = serializeMemo(undefined, { endDate: '2024-03-13' });
      expect(result).toContain(META_ID);
      expect(result).toContain('"endDate":"2024-03-13"');
    });

    it('여러 메타 키를 모두 포함한다', () => {
      const result = serializeMemo('내용', { endDate: '2024-03-15', flag: true });
      expect(result).toContain('"endDate":"2024-03-15"');
      expect(result).toContain('"flag":true');
    });
  });

  describe('이미 META_ID가 포함된 memo 처리', () => {
    it('기존 메타 블록을 잘라내고 새 메타로 교체한다', () => {
      // DB에서 꺼낸 값을 그대로 다시 직렬화하는 상황
      const stored = serializeMemo('기존 메모', { endDate: '2024-03-10' });
      const updated = serializeMemo(stored, { endDate: '2024-03-20' });

      // META_ID가 2번 나와서는 안 됨
      const count = updated.split(META_ID).length - 1;
      expect(count).toBe(1);
      expect(updated).toContain('"endDate":"2024-03-20"');
      expect(updated).not.toContain('"endDate":"2024-03-10"');
    });
  });
});

// ─────────────────────────────────────────────────────────────
// parseMemo
// ─────────────────────────────────────────────────────────────

describe('parseMemo', () => {
  describe('메타 없는 평문', () => {
    it('메타 없는 문자열은 memo를 그대로, meta를 빈 객체로 반환한다', () => {
      const result = parseMemo('단순 메모');
      expect(result.memo).toBe('단순 메모');
      expect(result.meta).toEqual({});
    });

    it('undefined 입력은 memo=undefined, meta={}를 반환한다', () => {
      const result = parseMemo(undefined);
      expect(result.memo).toBeUndefined();
      expect(result.meta).toEqual({});
    });

    it('빈 문자열 입력은 memo=빈문자열, meta={}를 반환한다', () => {
      const result = parseMemo('');
      expect(result.memo).toBeUndefined();
      expect(result.meta).toEqual({});
    });
  });

  describe('메타 포함 문자열', () => {
    it('endDate 메타를 올바르게 파싱한다', () => {
      const serialized = serializeMemo('다일 이벤트 메모', { endDate: '2024-03-15' });
      const result = parseMemo(serialized);
      expect(result.memo).toBe('다일 이벤트 메모');
      expect(result.meta.endDate).toBe('2024-03-15');
    });

    it('memo가 없고 메타만 있을 때 memo는 undefined다', () => {
      const serialized = serializeMemo(undefined, { endDate: '2024-03-15' });
      const result = parseMemo(serialized);
      expect(result.memo).toBeUndefined();
      expect(result.meta.endDate).toBe('2024-03-15');
    });

    it('손상된 JSON 메타는 원본 문자열을 memo로 반환하고 meta는 빈 객체다', () => {
      const broken = `메모\n${META_ID}\n{invalid json}`;
      const result = parseMemo(broken);
      expect(result.memo).toBe(broken);
      expect(result.meta).toEqual({});
    });
  });

  describe('라운드트립 (serialize → parse)', () => {
    it('텍스트+메타 직렬화 후 파싱하면 원본과 일치한다', () => {
      const memo = '다일 이벤트 내용';
      const meta = { endDate: '2024-03-20' };
      const { memo: parsedMemo, meta: parsedMeta } = parseMemo(serializeMemo(memo, meta));
      expect(parsedMemo).toBe(memo);
      expect(parsedMeta).toEqual(meta);
    });

    it('memo 없이 메타만 직렬화/파싱해도 데이터 손실 없음', () => {
      const meta = { endDate: '2024-12-31' };
      const { memo: parsedMemo, meta: parsedMeta } = parseMemo(serializeMemo(undefined, meta));
      expect(parsedMemo).toBeUndefined();
      expect(parsedMeta).toEqual(meta);
    });

    it('빈 meta로 직렬화 후 파싱하면 meta가 빈 객체다', () => {
      const { meta } = parseMemo(serializeMemo('메모', {}));
      expect(meta).toEqual({});
    });
  });
});
