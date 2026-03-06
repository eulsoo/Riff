import { useState, useEffect, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { saveGoogleRefreshToken } from './services/api';
import { clearCachedGoogleToken } from './lib/googleCalendar';
import { Login } from './components/Login';
import { MainLayout } from './components/MainLayout';
import { DataProvider } from './contexts/DataContext';
import { SelectionProvider, HoverProvider } from './contexts/SelectionContext';
import { DragProvider } from './contexts/DragContext';
import { WeekOrder } from './types';
import { getWeekStartForDate, getTodoWeekStart, formatLocalDate } from './utils/dateUtils';
import styles from './App.module.css';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [weekOrder, setWeekOrder] = useState<WeekOrder>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('weekOrder') : null;
    return saved === 'sun' ? 'sun' : 'mon';
  });

  const [pastWeeks, setPastWeeks] = useState(8);
  const [futureWeeks, setFutureWeeks] = useState(12);

  // 사용자별 localStorage 키 목록 (로그인 사용자가 바뀌면 초기화해야 함)
  const USER_SCOPED_LS_KEYS = [
    'caldavCalendarMetadata',       // 캘린더 메타데이터 (CalDAV)
    'localCalendarMetadata',        // 로컬 캘린더 메타데이터
    'riffHiddenCalendars',          // 캘린더 숨김 설정
    'googleCalendarsMeta',          // 구글 캘린더 메타
    'googleSelectedCalendarIds',    // 선택된 구글 캘린더 IDs
    'googleSyncTokens',             // 구글 동기화 토큰
    'googleTokenExpired',           // 구글 토큰 만료 플래그
    'user_emotions',                // 감정 이모지 기록
    'holiday_synced_v2',            // 공휴일 동기화 여부
  ];


  const clearOtherUserLocalStorage = (newUserId: string) => {
    const storedUserId = localStorage.getItem('riff_current_user_id');
    if (storedUserId && storedUserId !== newUserId) {
      // 다른 사용자가 로그인 → 이전 사용자의 캐시 데이터 초기화
      console.log(`[Auth] 사용자 변경 감지 (${storedUserId} → ${newUserId}). localStorage 초기화.`);
      USER_SCOPED_LS_KEYS.forEach(key => localStorage.removeItem(key));
      localStorage.removeItem('last_login_provider');
      // diaryCache:날짜 패턴 키 일괄 삭제 (패턴 키라 USER_SCOPED_LS_KEYS에 포함 불가)
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('diaryCache:')) localStorage.removeItem(key);
      });
      // 이전 사용자의 메모리 캐시 Google 토큰 초기화
      clearCachedGoogleToken();
    }
    localStorage.setItem('riff_current_user_id', newUserId);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) {
        clearOtherUserLocalStorage(session.user.id);
      }
      setSession(session);
      setSessionLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Only update session if we actually have a new session.
      // Avoid setting null on TOKEN_REFRESHED failures to prevent
      // unmounting the entire app tree and losing unsaved work.
      if (session) {
        // 사용자가 바뀐 경우 localStorage 초기화 (계정 간 데이터 오염 방지)
        if (session.user?.id) {
          clearOtherUserLocalStorage(session.user.id);
        }
        setSession(session);
        if (_event === 'SIGNED_IN' && session.provider_token && session.provider_refresh_token) {
          saveGoogleRefreshToken(session.provider_refresh_token).catch(console.error);
        }
      } else if (_event === 'SIGNED_OUT') {
        // Only clear session on explicit sign-out
        // 로그아웃 시 모든 캐시 데이터를 즉시 초기화하여 완전히 깨끗한 상태로 만듭니다.
        console.log('[Auth] 로그아웃 감지. 사용자 캐시 데이터 초기화.');
        USER_SCOPED_LS_KEYS.forEach(key => localStorage.removeItem(key));
        localStorage.removeItem('riff_current_user_id');
        localStorage.removeItem('last_login_provider');
        // diaryCache:날짜 패턴 키 일괄 삭제
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('diaryCache:')) localStorage.removeItem(key);
        });
        // 메모리에 캐싱된 Google access token 즉시 초기화
        clearCachedGoogleToken();
        setSession(null);
      }
      // For other events with null session (e.g., failed refresh),
      // keep the existing session to preserve UI state.
    });

    return () => subscription.unsubscribe();
  }, []);


  const handleGetWeekStartForDate = useCallback((date: Date) => getWeekStartForDate(date, weekOrder), [weekOrder]);
  const handleGetCurrentTodoWeekStart = useCallback(() => {
    const currentWeekStart = getWeekStartForDate(new Date(), weekOrder);
    return getTodoWeekStart(currentWeekStart, weekOrder);
  }, [weekOrder]);

  return (
    <div className={styles.appContainer}>
      {sessionLoading ? null : !session ? (
        <Login />
      ) : (
        <SelectionProvider>
          <HoverProvider>
            <DragProvider>
              <DataProvider
                session={session}
                weekOrder={weekOrder}
                pastWeeks={pastWeeks}
                futureWeeks={futureWeeks}
                getWeekStartForDate={handleGetWeekStartForDate}
                getCurrentTodoWeekStart={handleGetCurrentTodoWeekStart}
                formatLocalDate={formatLocalDate}
              >
                <MainLayout
                  session={session}
                  weekOrder={weekOrder}
                  setWeekOrder={setWeekOrder}
                  pastWeeks={pastWeeks}
                  setPastWeeks={setPastWeeks}
                  futureWeeks={futureWeeks}
                  setFutureWeeks={setFutureWeeks}
                  currentYear={currentYear}
                  setCurrentYear={setCurrentYear}
                  currentMonth={currentMonth}
                  setCurrentMonth={setCurrentMonth}
                />
              </DataProvider>
            </DragProvider>
          </HoverProvider>
        </SelectionProvider>
      )}
    </div>
  );
}