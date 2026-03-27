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
    } else if (provider === 'google') {
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
        // 구글 로그인 시 캘린더 범위를 요청
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
          현재 Riff는 베타 테스트중입니다.
        </p>
      </div>
    </div>
  );
}
