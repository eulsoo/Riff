import { useState, useEffect, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { Login } from './components/Login';
import { MainLayout } from './components/MainLayout';
import { DataProvider } from './contexts/DataContext';
import { SelectionProvider, HoverProvider } from './contexts/SelectionContext';
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
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
        setSession(session);
      } else if (_event === 'SIGNED_OUT') {
        // Only clear session on explicit sign-out
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
          </HoverProvider>
        </SelectionProvider>
      )}
    </div>
  );
}