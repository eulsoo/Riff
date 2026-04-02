import styles from './landing/Landing.module.css';
import { PrivacyContent, TermsContent } from './LegalModal';

interface LegalPageProps {
  type: 'privacy' | 'terms';
}

export function LegalPage({ type }: LegalPageProps) {
  const isPrivacy = type === 'privacy';

  return (
    <div className={styles.legalStandalone}>
      <header className={styles.legalStandaloneHeader}>
        <a href="/" className={styles.legalStandaloneHomeLink}>Riff 홈으로</a>
      </header>
      <main className={styles.legalStandaloneMain}>
        <h1 className={styles.legalStandaloneTitle}>
          {isPrivacy ? '개인정보처리방침' : '이용약관'}
        </h1>
        <div className={styles.legalStandaloneBody}>
          {isPrivacy ? <PrivacyContent /> : <TermsContent />}
        </div>
      </main>
    </div>
  );
}
