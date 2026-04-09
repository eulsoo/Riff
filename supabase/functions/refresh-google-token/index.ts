import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// ── AES-GCM 암호화 (caldav-proxy와 동일한 v2 포맷) ─────────────────────
async function getCryptoKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt']
  );
}

async function encryptToken(value: string, secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await getCryptoKey(secret, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(value)
  );
  const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  return `v2:${toB64(salt)}:${toB64(iv)}:${toB64(new Uint8Array(encrypted))}`;
}

async function decryptToken(encryptedStr: string, secret: string): Promise<string> {
  const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  if (!encryptedStr.startsWith('v2:')) {
    // 평문 토큰 (암호화 전 레거시 데이터)은 그대로 반환
    return encryptedStr;
  }
  const parts = encryptedStr.slice(3).split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');
  const [saltB64, ivB64, cipherB64] = parts;
  const key = await getCryptoKey(secret, fromB64(saltB64));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(cipherB64)
  );
  return new TextDecoder().decode(decrypted);
}
// ────────────────────────────────────────────────────────────────────────

// CORS: 환경변수 ALLOWED_ORIGIN으로 허용 오리진 제한 (미설정 시 개발 편의상 * 허용)
const getAllowedOrigin = (requestOrigin: string): string => {
  const allowedOrigins = (Deno.env.get('ALLOWED_ORIGIN') || '*').split(',').map((o: string) => o.trim());
  if (allowedOrigins.includes('*')) return '*';
  return allowedOrigins.includes(requestOrigin) ? requestOrigin : '';
};

const buildCorsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': getAllowedOrigin(origin),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
});

serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const corsHeaders = buildCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // anon 클라이언트 + Authorization 헤더 포워딩으로 JWT 검증 (Supabase 권장 패턴)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const body = await req.json().catch(() => ({}));

    const clientId = Deno.env.get('VITE_GOOGLE_CLIENT_ID') || Deno.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!clientId || !clientSecret || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── getAuthUrl 액션: Google OAuth 인증 URL 생성 (client_id를 서버에서 관리) ──
    if (body?.action === 'getAuthUrl') {
      const { redirectUri } = body;
      if (!redirectUri) {
        return new Response(JSON.stringify({ error: 'redirectUri가 필요합니다.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar');
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      return new Response(JSON.stringify({ url: url.toString() }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── exchange 액션: Google authorization code → access_token + refresh_token ──
    if (body?.action === 'exchange') {
      const { code, redirectUri } = body;
      if (!code || !redirectUri) {
        return new Response(JSON.stringify({ error: 'code와 redirectUri가 필요합니다.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }).toString(),
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) {
        console.error('Google 코드 교환 실패:', tokenData);
        return new Response(JSON.stringify({ error: 'Google 코드 교환 실패', detail: tokenData }), {
          status: tokenResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // refresh_token 암호화 후 저장
      if (tokenData.refresh_token) {
        const encrypted = await encryptToken(tokenData.refresh_token, serviceRoleKey);
        const { error: upsertError } = await supabaseClient
          .from('user_tokens')
          .upsert({ user_id: user.id, provider_refresh_token: encrypted, updated_at: new Date().toISOString() });
        if (upsertError) {
          console.error('토큰 저장 실패:', upsertError);
          return new Response(JSON.stringify({ error: '토큰 저장 중 오류가 발생했습니다.' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      return new Response(JSON.stringify({
        access_token: tokenData.access_token,
        expires_in: tokenData.expires_in,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── save 액션: 클라이언트에서 받은 refresh token을 암호화하여 저장 ──
    if (body?.action === 'save') {
      const { refreshToken } = body;
      if (!refreshToken || typeof refreshToken !== 'string') {
        return new Response(JSON.stringify({ error: 'refreshToken이 필요합니다.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const encrypted = await encryptToken(refreshToken, serviceRoleKey);
      const { error } = await supabaseClient
        .from('user_tokens')
        .upsert({ user_id: user.id, provider_refresh_token: encrypted, updated_at: new Date().toISOString() });

      if (error) {
        console.error('토큰 저장 실패:', error);
        return new Response(JSON.stringify({ error: '토큰 저장 중 오류가 발생했습니다.' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── refresh 액션 (기본): 저장된 token 복호화 후 Google에서 access token 발급 ──
    const { data: tokenData, error: tokenError } = await supabaseClient
      .from('user_tokens')
      .select('provider_refresh_token')
      .eq('user_id', user.id)
      .single();

    if (tokenError || !tokenData?.provider_refresh_token) {
      return new Response(JSON.stringify({ error: 'No refresh token found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const refreshToken = await decryptToken(tokenData.provider_refresh_token, serviceRoleKey);

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    const tokenResData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Google 토큰 갱신 실패:', tokenResData);
      return new Response(JSON.stringify({ error: 'Failed to refresh token with Google' }), {
        status: tokenResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      access_token: tokenResData.access_token,
      expires_in: tokenResData.expires_in,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('refresh-google-token 오류:', err);
    return new Response(JSON.stringify({ error: '토큰 처리 중 오류가 발생했습니다.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
