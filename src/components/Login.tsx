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

  const handleLogin = async (provider: 'google' | 'apple') => {
    localStorage.setItem('last_login_provider', provider);
    let queryParams: { [key: string]: string } | undefined;

    if (provider === 'google') {
      // 캘린더 읽기/쓰기 권한 및 백그라운드 사용을 위한 offline 옵션 추가
      queryParams = {
        access_type: 'offline',
        prompt: 'consent',
      };
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
        queryParams,
        scopes: provider === 'google' ? 'https://www.googleapis.com/auth/calendar' : undefined,
      },
    });

    if (error) {
      // 내부 오류 메시지는 콘솔에만 기록, 사용자에게는 일반화된 메시지 표시
      console.error('Error logging in:', error.message);
      alert('로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginVisual}>

        <div className={styles.loginHeader}>
          <h1 className={styles.loginTitle}>
            <img src="/images/riff_logo.svg" alt="Riff" />
          </h1>
          <p className={styles.loginSubtitle}>
            시간을 재즈처럼.
          </p>
        </div>
      </div>

      <div className={styles.loginCard}>
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
            {lastProvider === 'apple' && (
              <div className={styles.lastLoginBadge}>최근 사용</div>
            )}
            <button
              onClick={() => handleLogin('apple')}
              className={`${styles.loginButton} ${styles.apple}`}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.32 2.99-2.54 4zm-3.1-17.56c.06 2.06-1.52 3.7-3.52 3.86-.22-1.99 1.55-3.72 3.52-3.86z" fill="#000000"/>
              </svg>
              Apple로 계속하기
            </button>
          </div>
        </div>


        <p className={styles.loginFooter}>
          현재 Riff는 베타 테스트중입니다.
        </p>
      </div>
    </div>
  );
}
