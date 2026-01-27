
import { encryptData, decryptData } from './crypto';

const CACHE_VERSION = 'v1';

export const getCacheKey = (userId: string | undefined, suffix: string) => {
  if (!userId || typeof window === 'undefined') return null;
  return `calendarCache:${CACHE_VERSION}:${userId}:${suffix}`;
};

export const readCache = <T>(key: string, ttlMs: number): T | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    // 암호화된 데이터 복호화 시도
    const decrypted = decryptData<{ savedAt: number; data: T }>(raw);

    // 복호화 성공 시
    if (decrypted && decrypted.savedAt) {
      if (Date.now() - decrypted.savedAt > ttlMs) return null;
      return decrypted.data;
    }

    // 복호화 실패 시
    return null;
  } catch {
    return null;
  }
};

export const writeCache = (key: string, data: unknown) => {
  if (typeof window === 'undefined') return;
  try {
    const payload = { savedAt: Date.now(), data };
    const encrypted = encryptData(payload);
    window.localStorage.setItem(key, encrypted);
  } catch {
    // ignore quota errors
  }
};
