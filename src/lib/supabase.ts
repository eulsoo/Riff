
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase URL or Key is missing!');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',        // Authorization Code + PKCE (implicit flow 방지)
    autoRefreshToken: true,  // 세션 자동 갱신
    detectSessionInUrl: true, // OAuth redirect 후 URL에서 세션 감지
    persistSession: true,    // 세션 localStorage 유지 (기본값이지만 명시)
  },
});
