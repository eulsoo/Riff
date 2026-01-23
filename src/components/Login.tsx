import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import styles from './Login.module.css';

export function Login() {
  const [lastProvider, setLastProvider] = useState<string | null>(null);

  useEffect(() => {
    const last = localStorage.getItem('last_login_provider');
    if (last) {
      setLastProvider(last);
    }
  }, []);

  const handleLogin = async (provider: 'google' | 'kakao') => {
    localStorage.setItem('last_login_provider', provider);
    let queryParams: { [key: string]: string } | undefined;

    // 카카오 로그인 시 이메일 권한 요청 제외 (비즈니스 인증 문제 해결)
    if (provider === 'kakao') {
      queryParams = {
        // 필수 동의 항목만 요청: 닉네임, 프로필 사진
        // account_email을 제외하여 KOE205 에러 방지
        scope: 'profile_nickname,profile_image',
      };
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
        queryParams,
      },
    });

    if (error) {
      console.error('Error logging in:', error.message);
      alert('로그인 중 오류가 발생했습니다: ' + error.message);
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginCard}>
        <div className={styles.loginHeader}>
          <h1 className={styles.loginTitle}>Vivid Calendar</h1>
          <p className={styles.loginSubtitle}>일정과 루틴을 스마트하게 관리하세요</p>
        </div>

        <div className={styles.loginIconContainer}>
          <div className={styles.loginIconWrapper}>
            <svg
              className={styles.loginIcon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeWidth="2" />
              <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2" />
              <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2" />
              <line x1="3" y1="10" x2="21" y2="10" strokeWidth="2" />
            </svg>
          </div>
        </div>

        <div className={styles.buttonStack}>
          <div className={styles.buttonWrapper}>
            {lastProvider === 'google' && (
              <div className={styles.lastLoginBadge}>최근 사용</div>
            )}
            <button
              onClick={() => handleLogin('google')}
              className={styles.loginButton}
            >
              <img
                src="https://www.google.com/favicon.ico"
                alt="Google"
              />
              Google로 계속하기
            </button>
          </div>

          <div className={styles.buttonWrapper}>
            {lastProvider === 'kakao' && (
              <div className={styles.lastLoginBadge}>최근 사용</div>
            )}
            <button
              onClick={() => handleLogin('kakao')}
              className={`${styles.loginButton} ${styles.kakao}`}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 3C6.477 3 2 6.477 2 10.76C2 13.56 3.93 16.03 6.83 17.38C6.67 17.93 6.27 19.34 6.2 19.59C6.1 19.94 6.48 20.17 6.74 19.98C6.88 19.88 9.15 18.25 10.15 17.54C10.74 17.62 11.36 17.66 12 17.66C17.523 17.66 22 14.183 22 9.9C22 5.617 17.523 2.14 12 2.14V3Z" fill="#000000" />
              </svg>
              카카오로 시작하기
            </button>
          </div>
        </div>


        <p className={styles.loginFooter}>
          로그인하면 모든 기기에서 데이터가 동기화됩니다.
        </p>
      </div>
    </div>
  );
}
