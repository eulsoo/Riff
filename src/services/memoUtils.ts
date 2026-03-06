export const META_ID = '======VIVIDLY_META======';

/**
 * memo 텍스트와 메타데이터(endDate 등)를 하나의 문자열로 직렬화합니다.
 * DB의 memo 컬럼에 저장됩니다.
 */
export function serializeMemo(memo: string | undefined, meta: Record<string, any>): string {
  const cleanMemo = memo ? memo.split(META_ID)[0].trimEnd() : '';
  if (!meta || Object.keys(meta).length === 0) return cleanMemo;
  return `${cleanMemo}\n${META_ID}\n${JSON.stringify(meta)}`;
}

/**
 * DB에 저장된 memo 문자열을 텍스트와 메타데이터로 분리합니다.
 */
export function parseMemo(originalMemo: string | undefined): { memo: string | undefined; meta: Record<string, any> } {
  if (!originalMemo) return { memo: undefined, meta: {} };
  const parts = originalMemo.split(META_ID);
  if (parts.length < 2) return { memo: originalMemo, meta: {} };
  try {
    const meta = JSON.parse(parts[1].trim());
    return { memo: parts[0].trimEnd() || undefined, meta };
  } catch {
    return { memo: originalMemo, meta: {} };
  }
}
