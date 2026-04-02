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

export function PrivacyContent() {
  return (
    <div>
      <p className={styles.legalIntro}>
        Riff(이하 "서비스")는 이용자의 개인정보를 소중히 여기며, 「개인정보 보호법」을 준수합니다.
        본 방침은 서비스 이용 시 수집되는 개인정보의 처리 방법과 이용자 권리를 안내합니다.
      </p>

      <div className={styles.legalSection}>
        <h3>1. 수집하는 개인정보 항목 및 수집 방법</h3>
        <p><strong>가. 회원가입 및 로그인 시 수집 항목 (필수)</strong></p>
        <ul>
          <li>Google 로그인: 이메일 주소, 이름, 프로필 사진 URL</li>
          <li>Apple 로그인: 이메일 주소, 이름 (Apple이 제공하는 경우에 한함)</li>
        </ul>
        <p><strong>나. Google Calendar 연동 시 추가 수집 (선택, 이용자 명시적 동의 후)</strong></p>
        <ul>
          <li>Google Calendar 읽기·쓰기 권한 (OAuth 스코프: https://www.googleapis.com/auth/calendar)</li>
          <li>OAuth 액세스 토큰 및 리프레시 토큰</li>
          <li>Google Calendar에 저장된 일정 정보 (연동 범위 내)</li>
        </ul>
        <p><strong>다. 서비스 이용 중 생성·수집 항목</strong></p>
        <ul>
          <li>이용자가 직접 입력한 데이터: 일정, 할일, 루틴, 일기, 감정 기록</li>
          <li>CalDAV(iCloud) 연동 시: 이용자가 직접 입력한 앱 패스워드, 캘린더 데이터</li>
          <li>서비스 이용 기록: 접속 일시, 기능 이용 이력 (서버 로그)</li>
        </ul>
        <p><strong>라. 수집 방법</strong></p>
        <ul>
          <li>소셜 로그인(Google, Apple) OAuth 연동을 통한 자동 수집</li>
          <li>이용자가 서비스 내에서 직접 입력</li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>2. 개인정보의 처리 목적</h3>
        <ul>
          <li>회원 식별 및 계정 관리</li>
          <li>주간 캘린더 서비스 제공 (일정·할일·루틴·일기·감정 관리)</li>
          <li>Google Calendar 양방향 동기화 기능 제공</li>
          <li>iCloud(CalDAV) 캘린더 동기화 기능 제공</li>
          <li>서비스 품질 개선 및 오류 대응</li>
          <li>법령상 의무 이행</li>
        </ul>
        <p>
          Google API를 통해 수집된 정보는 Google Calendar 동기화 목적으로만 사용되며,
          광고, 사용자 프로파일링, 제3자 판매 등의 목적으로는 절대 사용되지 않습니다.
        </p>
        <p>
          또한 Google API를 통해 수집·처리되는 정보의 사용 및 이전은
          Google API Services User Data Policy의 Limited Use 요구사항을 준수합니다.
        </p>
      </div>

      <div className={styles.legalSection}>
        <h3>3. 개인정보의 처리 및 보유 기간</h3>
        <ul>
          <li><strong>원칙:</strong> 회원 탈퇴 시 지체 없이 파기 (30일 이내)</li>
          <li><strong>법령에 의한 보존:</strong>
            <ul>
              <li>전자상거래법: 계약·청약 기록 5년, 소비자 불만·분쟁 기록 3년</li>
              <li>통신비밀보호법: 서비스 이용 로그 3개월</li>
            </ul>
          </li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>4. 개인정보의 파기 절차 및 방법</h3>
        <ul>
          <li>전자적 파일: 복구 불가능한 방법으로 영구 삭제</li>
          <li>데이터베이스: 해당 레코드 및 연관 백업 데이터 삭제</li>
          <li>파기 시점: 보유 기간 만료 또는 처리 목적 달성 즉시</li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>5. 개인정보의 제3자 제공</h3>
        <p>서비스는 원칙적으로 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 아래의 경우는 예외입니다.</p>
        <ul>
          <li>이용자가 외부 캘린더 연동에 동의한 경우, 해당 서비스(Google, Apple) API 호출을 위한 최소 정보 전달</li>
          <li>법령에 의거하거나 수사기관의 적법한 요청이 있는 경우</li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>6. 개인정보 처리 위탁</h3>
        <p>서비스는 원활한 서비스 제공을 위해 아래와 같이 개인정보 처리를 위탁합니다.</p>
        <ul>
          <li><strong>Supabase Inc.</strong> — 데이터베이스 호스팅 및 인증 처리 (서버 위치: 대한민국)</li>
          <li><strong>Vercel Inc. (미국)</strong> — 웹 애플리케이션 서버 운영</li>
          <li><strong>Google LLC (미국)</strong> — Google OAuth 인증 및 Calendar API 연동</li>
          <li><strong>Apple Inc. (미국)</strong> — Apple Sign-in 인증 처리</li>
        </ul>
        <p>
          위탁업체는 위탁 목적 범위 내에서만 개인정보를 처리합니다.
          단, Google/Apple은 각사의 개인정보처리방침 및 약관에 따라 별도 처리할 수 있습니다.
        </p>
      </div>

      <div className={styles.legalSection}>
        <h3>7. 개인정보의 국외 이전 (「개인정보 보호법」 제28조의8)</h3>
        <p>
          이용자 데이터는 대한민국 리전 서버에 저장됩니다. 다만 아래 서비스 이용 과정에서
          일부 정보가 국외로 이전될 수 있습니다.
        </p>
        <ul>
          <li><strong>이전받는 자:</strong> Vercel Inc., Google LLC, Apple Inc.</li>
          <li><strong>이전 국가:</strong> 미국</li>
          <li><strong>이전 일시 및 방법:</strong> 서비스 이용 시 네트워크를 통해 상시 전송</li>
          <li><strong>이전 항목:</strong> 인증 정보, 웹 요청 처리를 위한 최소 데이터</li>
          <li><strong>이전 목적:</strong> 인증 처리 및 웹 서버 운영</li>
          <li><strong>보유 및 이용 기간:</strong> 회원 탈퇴 또는 처리 목적 달성 시까지 (단, 각 제공자의 정책에 따름)</li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>8. 자동 수집 장치 (쿠키 등)</h3>
        <ul>
          <li>서비스는 로그인 세션 유지를 위해 브라우저 로컬스토리지에 인증 토큰을 저장합니다.</li>
          <li>별도의 광고·추적 목적의 쿠키는 사용하지 않습니다.</li>
          <li>브라우저 설정을 통해 로컬스토리지를 삭제할 수 있으며, 이 경우 로그인이 해제됩니다.</li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>9. 개인정보의 안전성 확보 조치</h3>
        <ul>
          <li>데이터베이스 행 수준 보안(Row Level Security, RLS) 적용 — 본인 데이터에만 접근 가능</li>
          <li>외부 캘린더 인증 토큰은 서버 환경(Edge Function)에서만 처리, 클라이언트 미노출</li>
          <li>모든 통신 구간 HTTPS/TLS 암호화 적용</li>
          <li>Content Security Policy(CSP), X-Frame-Options 등 보안 헤더 적용</li>
          <li>서비스 키(Service Role Key)는 서버 환경에서만 사용</li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>10. 정보주체의 권리 및 행사 방법</h3>
        <p>이용자는 언제든지 아래 권리를 행사할 수 있습니다.</p>
        <ul>
          <li>개인정보 열람 요청</li>
          <li>오류 정정 요청</li>
          <li>삭제 요청 (서비스 내 회원 탈퇴 시 자동 처리)</li>
          <li>처리 정지 요청</li>
          <li>Google Calendar 연동 해제 (서비스 내 설정 또는 Google 계정 보안 페이지에서 직접 취소 가능)</li>
        </ul>
        <p>권리 행사는 서비스 내 설정 메뉴 또는 아래 개인정보 보호책임자에게 요청하실 수 있으며, 10일 이내에 조치합니다.</p>
      </div>

      <div className={styles.legalSection}>
        <h3>11. 개인정보 보호책임자</h3>
        <ul>
          <li><strong>담당:</strong> Riff 운영팀</li>
          <li><strong>이메일:</strong> support@riff.kr</li>
        </ul>
        <p>개인정보 관련 문의, 불만, 피해 신고는 위 연락처로 접수해 주세요.</p>
      </div>

      <div className={styles.legalSection}>
        <h3>12. 권익침해 구제 방법</h3>
        <p>개인정보 침해로 인한 피해를 구제받으시려면 아래 기관에 문의하실 수 있습니다.</p>
        <ul>
          <li><strong>개인정보보호위원회</strong> 개인정보 침해신고센터: privacy.go.kr / ☎ 182</li>
          <li><strong>한국인터넷진흥원(KISA)</strong> 개인정보 침해신고센터: privacy.kisa.or.kr / ☎ 118</li>
          <li><strong>대검찰청</strong> 사이버수사과: spo.go.kr / ☎ 1301</li>
          <li><strong>경찰청</strong> 사이버수사국: ecrm.cyber.go.kr / ☎ 182</li>
        </ul>
      </div>

      <p className={styles.legalFootnote}>시행일: 2026년 4월 2일 | 버전: 1.0</p>
    </div>
  );
}

export function TermsContent() {
  return (
    <div>
      <p className={styles.legalIntro}>
        본 이용약관은 Riff 운영팀(이하 "회사")이 제공하는 Riff 서비스(이하 "서비스")의 이용 조건 및
        절차에 관한 사항을 규정합니다.
      </p>

      <div className={styles.legalSection}>
        <h3>제1조 (목적)</h3>
        <p>
          본 약관은 회사가 운영하는 Riff(riff.app, 이하 "서비스")의 이용과 관련하여 회사와
          이용자 간의 권리, 의무 및 책임 사항을 규정함을 목적으로 합니다.
        </p>
      </div>

      <div className={styles.legalSection}>
        <h3>제2조 (약관의 효력 및 변경)</h3>
        <ul>
          <li>본 약관은 서비스 화면에 게시하거나 기타 방법으로 공지함으로써 효력을 발생합니다.</li>
          <li>
            회사는 「약관의 규제에 관한 법률」, 「전자상거래 등에서의 소비자 보호에 관한 법률」 등
            관련 법령을 위반하지 않는 범위에서 본 약관을 변경할 수 있습니다.
          </li>
          <li>약관 변경 시 적용일 7일 전에 서비스 내 공지하며, 이용자에게 불리한 변경은 30일 전에 공지합니다.</li>
          <li>이용자가 변경된 약관에 동의하지 않을 경우 서비스 이용을 중단하고 탈퇴할 수 있습니다.</li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>제3조 (서비스 제공)</h3>
        <p>회사는 아래 서비스를 제공합니다.</p>
        <ul>
          <li>주간 단위 일정(캘린더) 관리</li>
          <li>할일(Todo) 관리</li>
          <li>루틴(Routine) 설정 및 추적</li>
          <li>일기 및 감정 기록</li>
          <li>Google Calendar 및 iCloud(CalDAV) 캘린더 동기화</li>
          <li>기타 회사가 추가로 개발하거나 제휴를 통해 제공하는 서비스</li>
        </ul>
        <p>서비스는 현재 베타 버전으로 제공되며, 기능·UI 등이 변경될 수 있습니다.</p>
      </div>

      <div className={styles.legalSection}>
        <h3>제4조 (이용계약의 성립)</h3>
        <ul>
          <li>이용계약은 이용자가 약관에 동의하고 Google 또는 Apple 소셜 로그인을 완료함으로써 성립합니다.</li>
          <li>만 14세 미만의 아동은 서비스를 이용할 수 없습니다.</li>
          <li>
            회사는 아래에 해당하는 경우 이용계약 성립을 거부하거나 취소할 수 있습니다.
            <ul>
              <li>타인의 정보를 도용하거나 허위 정보를 제공한 경우</li>
              <li>서비스 이용 제한 이력이 있는 경우</li>
              <li>기타 이 약관에 위배되는 경우</li>
            </ul>
          </li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>제5조 (이용자의 의무)</h3>
        <p>이용자는 아래 행위를 하여서는 안 됩니다.</p>
        <ul>
          <li>타인의 계정 정보를 도용하거나 무단으로 이용하는 행위</li>
          <li>서비스를 이용하여 법령 또는 공서양속에 위반되는 행위</li>
          <li>서비스의 정상적인 운영을 방해하는 행위 (크롤링, 과부하 유발 등)</li>
          <li>회사 또는 제3자의 지식재산권을 침해하는 행위</li>
          <li>서비스를 역설계·분해하거나 소스코드를 추출하려는 행위</li>
          <li>기타 관계 법령에서 금지하는 행위</li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>제6조 (회사의 의무)</h3>
        <ul>
          <li>안정적인 서비스 제공을 위해 지속적으로 노력합니다.</li>
          <li>이용자의 개인정보를 개인정보처리방침에 따라 안전하게 관리합니다.</li>
          <li>서비스 이용과 관련한 이용자의 불만 및 의견을 성실히 처리합니다.</li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>제7조 (서비스 이용 제한)</h3>
        <p>
          회사는 이용자가 제5조(이용자의 의무)를 위반하거나 서비스의 정상적인 운영을 방해하는 경우,
          사전 통지 없이 서비스 이용을 제한하거나 이용계약을 해지할 수 있습니다.
          이 경우 이용자는 이의를 제기할 수 있으며, 회사는 합리적인 기간 내에 결과를 안내합니다.
        </p>
      </div>

      <div className={styles.legalSection}>
        <h3>제8조 (서비스 변경 및 중단)</h3>
        <ul>
          <li>회사는 서비스의 내용·기능을 변경할 수 있으며, 변경 사항은 사전에 공지합니다.</li>
          <li>
            천재지변, 국가 비상사태, 서버 장애, 정기 점검 등 불가항력적 사유로 서비스를
            일시 중단할 수 있으며, 이 경우 최대한 빠르게 공지하고 복구합니다.
          </li>
          <li>서비스를 영구 종료하는 경우 30일 전에 공지합니다.</li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>제9조 (이용자 데이터)</h3>
        <ul>
          <li>이용자가 서비스 내에서 생성한 데이터(일정, 일기 등)의 저작권은 이용자에게 있습니다.</li>
          <li>회사는 서비스 제공 목적 외로 이용자 데이터를 이용하지 않습니다.</li>
          <li>회원 탈퇴 시 이용자 데이터는 30일 이내에 파기됩니다. 단, 법령에서 보존을 요구하는 경우는 예외입니다.</li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>제10조 (손해배상 및 면책)</h3>
        <ul>
          <li>
            회사는 무료로 제공하는 서비스의 이용과 관련하여 이용자에게 발생한 손해에 대해
            「약관의 규제에 관한 법률」 등 관련 법령이 허용하는 범위 내에서 책임을 제한합니다.
          </li>
          <li>
            천재지변, 전쟁, 통신 장애, 해킹 등 회사의 귀책 사유 없는 불가항력으로 인한 서비스 중단에
            대해서는 책임을 지지 않습니다.
          </li>
          <li>이용자의 귀책 사유로 발생한 서비스 이용 장애에 대해서는 회사가 책임지지 않습니다.</li>
          <li>
            회사는 이용자가 서비스를 이용하여 기대하는 수익을 얻지 못하거나 서비스를 통해 얻은
            자료로 인한 손해에 대해서는 책임을 지지 않습니다.
          </li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>제11조 (분쟁 해결)</h3>
        <ul>
          <li>서비스 이용과 관련하여 분쟁이 발생한 경우 회사와 이용자는 성실하게 협의합니다.</li>
          <li>협의가 이루어지지 않을 경우, 「콘텐츠산업 진흥법」에 따른 콘텐츠분쟁조정위원회에 조정을 신청할 수 있습니다.</li>
        </ul>
      </div>

      <div className={styles.legalSection}>
        <h3>제12조 (준거법 및 관할법원)</h3>
        <ul>
          <li>본 약관은 대한민국 법률을 준거법으로 합니다.</li>
          <li>서비스 이용과 관련하여 소송이 제기될 경우 민사소송법에 따른 관할법원을 제1심 법원으로 합니다.</li>
        </ul>
      </div>

      <p className={styles.legalFootnote}>시행일: 2026년 4월 2일 | 버전: 1.0</p>
    </div>
  );
}
