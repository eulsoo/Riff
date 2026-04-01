import { useEffect, useRef } from 'react';
import styles from './landing/Landing.module.css';

interface LegalModalProps {
  type: 'privacy' | 'terms';
  open: boolean;
  onClose: () => void;
}

export function LegalModal({ type, open, onClose }: LegalModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  const isPrivacy = type === 'privacy';

  return (
    <div
      className={styles.modalOverlay}
      onMouseDown={(e) => {
        if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
      }}
    >
      <div ref={boxRef} className={styles.modalBox}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>
            {isPrivacy ? '개인정보처리방침' : '이용약관'}
          </h2>
          <button className={styles.modalClose} onClick={onClose} aria-label="닫기">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" strokeWidth="2" strokeLinecap="round" />
              <line x1="6" y1="6" x2="18" y2="18" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className={styles.modalBody}>
          {isPrivacy ? <PrivacyContent /> : <TermsContent />}
        </div>
      </div>
    </div>
  );
}

function PrivacyContent() {
  return (
    <div>
      <div className={styles.legalSection}>
        <h3>1. 수집하는 개인정보 항목</h3>
        <ul>
          <li>Google 계정 이메일, 프로필 사진 (OAuth)</li>
          <li>앱 내 생성 데이터 (일정, 할일, 일기, 감정)</li>
          <li>외부 캘린더 연동 시 인증 토큰 (CalDAV, Google Calendar)</li>
        </ul>
      </div>
      <div className={styles.legalSection}>
        <h3>2. 수집 목적</h3>
        <ul>
          <li>서비스 제공 및 계정 관리</li>
          <li>캘린더 동기화 기능 제공</li>
        </ul>
      </div>
      <div className={styles.legalSection}>
        <h3>3. 보유 기간</h3>
        <ul>
          <li>회원 탈퇴 시 즉시 삭제</li>
          <li>법령에서 보존을 요구하는 경우 해당 기간</li>
        </ul>
      </div>
      <div className={styles.legalSection}>
        <h3>4. 제3자 제공</h3>
        <ul>
          <li>원칙적으로 제3자 제공 없음</li>
          <li>외부 캘린더 동기화 시 해당 서비스(Google, Apple)에만</li>
        </ul>
      </div>
      <div className={styles.legalSection}>
        <h3>5. 이용자 권리</h3>
        <ul>
          <li>개인정보 열람, 수정, 삭제 요청 가능</li>
          <li>문의: support@riff.app</li>
        </ul>
      </div>
      <p className={styles.legalFootnote}>시행일: 2025년 1월 1일</p>
    </div>
  );
}

function TermsContent() {
  return (
    <div>
      <div className={styles.legalSection}>
        <h3>1. 서비스 소개</h3>
        <p>Riff는 개인 일정 관리 웹 서비스입니다.</p>
      </div>
      <div className={styles.legalSection}>
        <h3>2. 이용자의 의무</h3>
        <ul>
          <li>타인의 계정을 무단 사용하지 않을 것</li>
          <li>서비스를 불법적인 목적으로 사용하지 않을 것</li>
        </ul>
      </div>
      <div className={styles.legalSection}>
        <h3>3. 서비스 제공자의 의무</h3>
        <ul>
          <li>지속적이고 안정적인 서비스 제공을 위해 노력</li>
          <li>개인정보를 안전하게 관리</li>
        </ul>
      </div>
      <div className={styles.legalSection}>
        <h3>4. 서비스 변경 및 중단</h3>
        <p>서비스 변경/중단 시 사전 공지</p>
      </div>
      <div className={styles.legalSection}>
        <h3>5. 면책 조항</h3>
        <p>천재지변, 통신 장애 등 불가항력적 상황 제외</p>
      </div>
      <div className={styles.legalSection}>
        <h3>6. 준거법</h3>
        <p>대한민국 법률을 준거법으로 함</p>
      </div>
      <p className={styles.legalFootnote}>시행일: 2025년 1월 1일</p>
    </div>
  );
}
