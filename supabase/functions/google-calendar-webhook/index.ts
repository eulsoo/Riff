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
    return encryptedStr; // 평문 레거시 토큰
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

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end:   { dateTime?: string; date?: string };
  status?: string;
  iCalUID?: string;
  etag?: string;
  colorId?: string;
}

const GOOGLE_COLOR_MAP: Record<string, string> = {
  '1':  '#ac725e', '2':  '#d06b64', '3':  '#f83a22', '4':  '#fa573c',
  '5':  '#ff7537', '6':  '#ffad46', '7':  '#42d692', '8':  '#16a765',
  '9':  '#7bd148', '10': '#b3dc6c', '11': '#9fc6e7',
};

function googleColorIdToHex(colorId?: string, fallback = '#4285F4'): string {
  if (!colorId) return fallback;
  return GOOGLE_COLOR_MAP[colorId] ?? fallback;
}

/** Google 이벤트 → Supabase events 행 변환 */
function mapGoogleEventToRow(
  gEvent: GoogleEvent,
  calendarId: string,
  userId: string,
  color: string
): Record<string, unknown> | null {
  if (gEvent.status === 'cancelled') return null;

  const isAllDay = Boolean(gEvent.start.date);
  const startDateStr = isAllDay
    ? gEvent.start.date!
    : (gEvent.start.dateTime ?? '').slice(0, 10);

  const endDateStr = isAllDay
    ? (() => {
        const d = new Date(gEvent.end.date!);
        d.setDate(d.getDate() - 1);
        return d.toISOString().slice(0, 10);
      })()
    : (gEvent.end.dateTime ?? '').slice(0, 10);

  const startTime = isAllDay ? null : (gEvent.start.dateTime ?? '').slice(11, 16);
  const endTime   = isAllDay ? null : (gEvent.end.dateTime   ?? '').slice(11, 16);
  const endDate   = endDateStr && endDateStr !== startDateStr ? endDateStr : null;

  // endDate는 memo JSON에 저장 (기존 serializeMemo 패턴과 동일)
  const memoObj: Record<string, unknown> = {};
  if (gEvent.description) memoObj.text = gEvent.description;
  if (endDate) memoObj.endDate = endDate;
  const memo = Object.keys(memoObj).length > 0 ? JSON.stringify(memoObj) : null;

  return {
    date: startDateStr,
    title: gEvent.summary ?? '(제목 없음)',
    memo,
    start_time: startTime,
    end_time: endTime,
    color: gEvent.colorId ? googleColorIdToHex(gEvent.colorId, color) : color,
    calendar_url: `google:${calendarId}`,
    caldav_uid: gEvent.id,
    source: 'google',
    etag: gEvent.etag ?? null,
    user_id: userId,
  };
}

/** Google Calendar Events API 호출 (페이지네이션 포함) */
async function fetchGoogleEventsServer(
  accessToken: string,
  calendarId: string,
  updatedMin?: string
): Promise<GoogleEvent[]> {
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const query = new URLSearchParams({
    maxResults: '2500',
    singleEvents: 'true',
    showDeleted: 'true',  // cancelled 이벤트도 포함 (삭제 처리용)
  });
  if (updatedMin) query.set('updatedMin', updatedMin);

  let allEvents: GoogleEvent[] = [];
  let pageToken: string | undefined;

  do {
    if (pageToken) query.set('pageToken', pageToken);
    const res = await fetch(`${baseUrl}?${query.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`fetchGoogleEventsServer failed: ${res.status} ${(err as any).error?.message ?? ''}`);
    }
    const data = await res.json();
    allEvents = allEvents.concat((data.items ?? []) as GoogleEvent[]);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allEvents;
}

/** Google OAuth access_token 발급 (refresh_token 사용) */
async function fetchAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
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

// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  // Google Watch API는 OPTIONS를 보내지 않지만 안전하게 처리
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }

  // 초기 sync 신호(resource-state: sync)는 무시
  const resourceState = req.headers.get('X-Goog-Resource-State');
  if (resourceState === 'sync') {
    return new Response('ok', { status: 200 });
  }

  const channelId    = req.headers.get('X-Goog-Channel-ID');
  const channelToken = req.headers.get('X-Goog-Channel-Token');

  if (!channelId) {
    return new Response('Bad Request', { status: 400 });
  }

  const SUPABASE_URL             = Deno.env.get('SUPABASE_URL') ?? '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const CLIENT_ID     = Deno.env.get('VITE_GOOGLE_CLIENT_ID') || Deno.env.get('GOOGLE_CLIENT_ID') || '';
  const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. channel_id → 채널 정보 조회
    const { data: channel, error: chErr } = await serviceClient
      .from('google_watch_channels')
      .select('user_id, calendar_id, last_sync_at, channel_id')
      .eq('channel_id', channelId)
      .single();

    if (chErr || !channel) {
      return new Response('Not Found', { status: 404 });
    }

    // 2. X-Goog-Channel-Token 검증 (등록 시 token=channel_id로 설정)
    if (channelToken !== channel.channel_id) {
      console.warn('[Webhook] Invalid channel token, rejecting');
      return new Response('Forbidden', { status: 403 });
    }

    // 3. 캘린더 색상 조회
    const { data: calMeta } = await serviceClient
      .from('calendar_metadata')
      .select('color')
      .eq('user_id', channel.user_id)
      .eq('google_calendar_id', channel.calendar_id)
      .maybeSingle();
    const color = calMeta?.color ?? '#4285F4';

    // 4. refresh_token 복호화 → access_token 발급
    const { data: tokenRow, error: tokenErr } = await serviceClient
      .from('user_tokens')
      .select('provider_refresh_token')
      .eq('user_id', channel.user_id)
      .single();

    if (tokenErr || !tokenRow?.provider_refresh_token) {
      console.error('[Webhook] No refresh token for user', channel.user_id);
      return new Response('Internal Server Error', { status: 500 });
    }

    const refreshToken = await decryptToken(tokenRow.provider_refresh_token, SUPABASE_SERVICE_ROLE_KEY);
    const accessToken  = await fetchAccessToken(refreshToken, CLIENT_ID, CLIENT_SECRET);

    // 5. updatedMin = last_sync_at - 60s (60s 오버랩 윈도우)
    const updatedMin = channel.last_sync_at
      ? new Date(new Date(channel.last_sync_at).getTime() - 60_000).toISOString()
      : undefined;

    const gEvents = await fetchGoogleEventsServer(accessToken, channel.calendar_id, updatedMin);

    // 6. upsert / delete 분류
    const toUpsert: Record<string, unknown>[] = [];
    const toDeleteUids: string[] = [];

    for (const ev of gEvents) {
      if (ev.status === 'cancelled') {
        if (ev.id) toDeleteUids.push(ev.id);
      } else {
        const row = mapGoogleEventToRow(ev, channel.calendar_id, channel.user_id, color);
        if (row) toUpsert.push(row);
      }
    }

    // 7. DB 업데이트 (병렬)
    const calendarUrl = `google:${channel.calendar_id}`;
    await Promise.all([
      toUpsert.length > 0
        ? serviceClient
            .from('events')
            .upsert(toUpsert, { onConflict: 'user_id,caldav_uid,calendar_url' })
            .then(({ error }) => { if (error) console.error('[Webhook] upsert error:', error); })
        : Promise.resolve(),
      toDeleteUids.length > 0
        ? serviceClient
            .from('events')
            .delete()
            .in('caldav_uid', toDeleteUids)
            .eq('calendar_url', calendarUrl)
            .eq('user_id', channel.user_id)
            .then(({ error }) => { if (error) console.error('[Webhook] delete error:', error); })
        : Promise.resolve(),
    ]);

    // 8. last_sync_at 갱신
    await serviceClient
      .from('google_watch_channels')
      .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('channel_id', channelId);

    // 9. Realtime Broadcast → 브라우저에 즉시 반영 신호
    await serviceClient
      .channel(`google-webhook-${channel.user_id}`)
      .send({
        type: 'broadcast',
        event: 'sync-complete',
        payload: { calendarId: channel.calendar_id },
      });

    console.log(`[Webhook] sync complete: user=${channel.user_id} cal=${channel.calendar_id} upsert=${toUpsert.length} delete=${toDeleteUids.length}`);
    return new Response('ok', { status: 200 });

  } catch (err) {
    console.error('[Webhook] Error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
});
