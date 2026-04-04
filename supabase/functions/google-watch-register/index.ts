import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// ── AES-GCM 복호화 (refresh-google-token과 동일한 v2 포맷) ──────────────────
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

async function decryptToken(encryptedStr: string, secret: string): Promise<string> {
  const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  if (!encryptedStr.startsWith('v2:')) {
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
// ─────────────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** user_tokens에서 refresh_token 복호화 → Google access_token 발급 */
async function getAccessTokenForUser(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  serviceRoleKey: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const { data: tokenRow, error } = await serviceClient
    .from('user_tokens')
    .select('provider_refresh_token')
    .eq('user_id', userId)
    .single();

  if (error || !tokenRow?.provider_refresh_token) {
    throw new Error(`No refresh token for user ${userId}`);
  }

  const refreshToken = await decryptToken(tokenRow.provider_refresh_token, serviceRoleKey);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token refresh failed: ${res.status} ${data.error ?? ''}`);
  }
  return data.access_token as string;
}

/** 특정 캘린더에 Watch 채널 등록 (기존 채널 stop 후 재등록) */
async function registerChannelForCalendar(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  accessToken: string,
  calendarId: string,
  supabaseUrl: string,
  color = '#4285F4'
): Promise<void> {
  const newChannelId = crypto.randomUUID();
  const webhookUrl = `${supabaseUrl}/functions/v1/google-calendar-webhook`;

  // 기존 채널 조회 → stop 후 재등록 (중복 webhook 방지)
  const { data: existing } = await serviceClient
    .from('google_watch_channels')
    .select('channel_id, resource_id')
    .eq('user_id', userId)
    .eq('calendar_id', calendarId)
    .maybeSingle();

  if (existing?.resource_id) {
    await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: existing.channel_id, resourceId: existing.resource_id }),
    }).catch(() => { /* 이미 만료된 채널은 무시 */ });
  }

  // Google Watch 채널 등록
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: newChannelId,
        type: 'web_hook',
        address: webhookUrl,
        token: newChannelId, // X-Goog-Channel-Token 검증용
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Watch registration failed: ${res.status} ${(err as any).error?.message ?? ''}`);
  }

  const data = await res.json();

  await serviceClient
    .from('google_watch_channels')
    .upsert(
      {
        user_id: userId,
        calendar_id: calendarId,
        channel_id: newChannelId,
        resource_id: data.resourceId,
        expiry: new Date(Number(data.expiration)).toISOString(),
        color,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,calendar_id' }
    );

  console.log(`[WatchRegister] channel registered: user=${userId} cal=${calendarId} channel=${newChannelId}`);
}

/** 만료 24시간 이내 채널 전체 갱신 (Cron 호출) */
async function renewExpiringChannels(
  serviceClient: ReturnType<typeof createClient>,
  serviceRoleKey: string,
  clientId: string,
  clientSecret: string,
  supabaseUrl: string
): Promise<void> {
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: expiring, error } = await serviceClient
    .from('google_watch_channels')
    .select('user_id, calendar_id')
    .lt('expiry', cutoff);

  if (error) {
    console.error('[WatchRegister] renewAll query error:', error);
    return;
  }

  console.log(`[WatchRegister] renewAll: ${expiring?.length ?? 0} channels to renew`);

  for (const ch of expiring ?? []) {
    try {
      const accessToken = await getAccessTokenForUser(
        serviceClient, ch.user_id, serviceRoleKey, clientId, clientSecret
      );
      await registerChannelForCalendar(serviceClient, ch.user_id, accessToken, ch.calendar_id, supabaseUrl);
    } catch (e) {
      console.error(`[WatchRegister] renewAll failed for user=${ch.user_id} cal=${ch.calendar_id}:`, e);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') ?? '';
  const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const CLIENT_ID      = Deno.env.get('VITE_GOOGLE_CLIENT_ID') || Deno.env.get('GOOGLE_CLIENT_ID') || '';
  const CLIENT_SECRET  = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';

  try {
    const body = await req.json().catch(() => ({}));

    // ── renewAll: service_role JWT 전용 ────────────────────────────────────
    if (body.renewAll) {
      const authHeader = req.headers.get('Authorization') ?? '';
      const jwt = authHeader.replace('Bearer ', '');
      let role = '';
      try {
        const payload = JSON.parse(atob(jwt.split('.')[1]));
        role = payload.role ?? '';
      } catch {
        // JWT 파싱 실패
      }
      if (role !== 'service_role') {
        return new Response('Forbidden', { status: 403, headers: CORS_HEADERS });
      }

      const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await renewExpiringChannels(serviceClient, SUPABASE_SERVICE_ROLE_KEY, CLIENT_ID, CLIENT_SECRET, SUPABASE_URL);
      return new Response('ok', { status: 200, headers: CORS_HEADERS });
    }

    // ── 클라이언트 요청: user JWT로 본인 캘린더 등록 ───────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace('Bearer ', '');
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: userErr } = await adminClient.auth.getUser(jwt);
    if (userErr || !user) {
      console.error('[WatchRegister] getUser failed:', userErr?.message, 'auth header present:', !!authHeader);
      return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
    }

    const calendarIds: string[] = Array.isArray(body.calendarIds) ? body.calendarIds : [];
    if (calendarIds.length === 0) {
      return new Response(JSON.stringify({ error: 'calendarIds is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const colors: Record<string, string> = body.colors && typeof body.colors === 'object' ? body.colors : {};

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    for (const calendarId of calendarIds) {
      try {
        const accessToken = await getAccessTokenForUser(
          serviceClient, user.id, SUPABASE_SERVICE_ROLE_KEY, CLIENT_ID, CLIENT_SECRET
        );
        await registerChannelForCalendar(serviceClient, user.id, accessToken, calendarId, SUPABASE_URL, colors[calendarId] ?? '#4285F4');
      } catch (e) {
        console.error(`[WatchRegister] failed for cal=${calendarId}:`, e);
        // 개별 실패는 무시 — 폴링 fallback으로 동작
      }
    }

    return new Response('ok', { status: 200, headers: CORS_HEADERS });

  } catch (err) {
    console.error('[WatchRegister] Error:', err);
    return new Response('Internal Server Error', {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});
