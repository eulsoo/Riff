import CryptoJS from 'crypto-js';

// 실제 운영 환경에서는 환경 변수 등을 통해 키를 관리하는 것이 좋습니다.
// 현재는 로컬 스토리지 난독화를 목적으로 하므로 고정 키를 사용합니다.
const SECRET_KEY = 'es-calendar-secure-storage-key';

export const encryptData = (data: any): string => {
  try {
    const jsonString = JSON.stringify(data);
    return CryptoJS.AES.encrypt(jsonString, SECRET_KEY).toString();
  } catch (error) {
    console.error('Data encryption failed:', error);
    return '';
  }
};

export const decryptData = <T>(ciphertext: string): T | null => {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
    const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
    if (!decryptedString) return null;
    return JSON.parse(decryptedString) as T;
  } catch (error) {
    // 복호화 실패 (키 불일치 또는 데이터 손상, 또는 평문 데이터인 경우)
    // 기존 평문 데이터와의 호환성을 위해 null 리턴 전 로그 남김
    // console.warn('Data decryption failed, possibly clearing old cache');
    return null;
  }
};
