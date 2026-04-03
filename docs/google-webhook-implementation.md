# Google Calendar Webhook 구현 계획

> Google Calendar 변경 사항을 Riff 웹에 즉시 반영하기 위한 Watch API + Webhook 구현.
> 현재 5분 폴링 → 구글 변경 즉시 반영으로 개선.
> 최초 작성: 2026-04-03

---

## 목차

1. [목표 및 아키텍처](#1-목표-및-아키텍처)
2. [DB 스키마 — google_watch_channels](#2-db-스키마--google_watch_channels)
3. [Edge Function — google-calendar-webhook](#3-edge-function--google-calendar-webhook)
4. [Edge Function — google-watch-register](#4-edge-function--google-watch-register)
5. [채널 자동 갱신 — Supabase Cron](#5-채널-자동-갱신--supabase-cron)
6. [클라이언트 변경 — DataContext](#6-클라이언트-변경--dataccontext)
7. [보안](#7-보안)
8. [구현 순서](#8-구현-순서)

---

## 1. 목표 및 아키텍처

### Before (현재)

```
Google Calendar에서 이벤트 수정
→ Riff 웹: 최대 5분 후 폴링으로 감지
```

### After (목표)

```
Google Calendar에서 이벤트 수정
→ Google이 Supabase Edge Function에 즉시 POST
→ Edge Function이 DB 업데이트
→ Supabase Realtime Broadcast → Riff 웹 즉시 반영
```

### 전체 흐름

```
[최초 연결 시]
브라우저 → google-watch-register 호출
         → Google /watch API로 채널 등록
         → channel_id, expiry → google_watch_channels 테이블 저장

[Google에서 변경 발생 시]
Google → POST /functions/v1/google-calendar-webhook
  Headers: X-Goog-Channel-ID: {channel_id}
           X-Goog-Resource-State: exists

Edge Function:
  1. channel_id로 DB에서 user_id, calendar_id 조회
  2. X-Goog-Channel-Token 검증 (DB channel_id와 비교) → 불일치 시 403
  3. user_tokens에서 refresh_token 복호화 → access_token 발급
  4. fetchGoogleEvents(updatedMin = last_sync_at - 60s) → 60s 오버랩으로 경계 이벤트 보완
  5. bulkUpsert / delete → events 테이블 업데이트
  6. last_sync_at 갱신 → google_watch_channels 업데이트
  7. Supabase Realtime Broadcast → 'google-webhook-{userId}' 채널에 신호

브라우저:
  Realtime Broadcast 수신 → loadData(true) 즉시 실행
```

### 핵심 설계 결정

**웹은 events 테이블 Realtime 구독을 추가하지 않는다.**
기존 sync 루프 방지 설계(§11-6)를 유지하고, 대신 **별도 Broadcast 채널**로 통지.
Broadcast는 `syncGoogleCalendar()`를 재트리거하지 않고 `loadData(true)`만 실행 → 루프 없음.

---

## 2. DB 스키마 — google_watch_channels

### 마이그레이션 파일: `supabase/migrations/20260403_add_google_watch_channels.sql`

```sql
-- Google Calendar Watch API 채널 정보 저장
CREATE TABLE IF NOT EXISTS google_watch_channels (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calendar_id    TEXT NOT NULL,           -- Google Calendar ID (e.g. 'primary', 'xxx@group.calendar.google.com')
  channel_id     TEXT NOT NULL UNIQUE,   -- Riff가 생성한 UUID. Google이 webhook 헤더로 전송.
  resource_id    TEXT,                   -- Google이 반환. 채널 해제(stop) 시 필요.
  expiry         TIMESTAMPTZ NOT NULL,   -- 채널 만료 시각 (최대 7일)
  last_sync_at   TIMESTAMPTZ,            -- 마지막 성공 sync 시각. updatedMin으로 활용.
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),

  -- 유저당 캘린더당 채널 1개 유지
  UNIQUE(user_id, calendar_id)
);

-- RLS
ALTER TABLE google_watch_channels ENABLE ROW LEVEL SECURITY;

-- 유저는 자신의 채널만 조회 가능 (Edge Function은 service_role로 접근하므로 RLS 우회)
CREATE POLICY "Users can view own watch channels"
  ON google_watch_channels
  FOR SELECT
  USING (auth.uid() = user_id);

-- 인덱스: 만료 임박 채널 조회용 (Cron에서 사용)
CREATE INDEX IF NOT EXISTS google_watch_channels_expiry_idx
  ON google_watch_channels(expiry);

-- 인덱스: channel_id 조회용 (webhook 수신 시 사용)
CREATE INDEX IF NOT EXISTS google_watch_channels_channel_id_idx
  ON google_watch_channels(channel_id);
```

---

## 3. Edge Function — google-calendar-webhook

### 파일: `supabase/functions/google-calendar-webhook/index.ts`

**역할**: Google Watch API의 webhook 수신 엔드포인트.

```
POST https://<project>.supabase.co/functions/v1/google-calendar-webhook
Headers:
  X-Goog-Channel-ID: {channel_id}
  X-Goog-Resource-State: sync | exists
  X-Goog-Resource-ID: {resource_id}
```

**처리 로직**:

```typescript
serve(async (req) => {
  // 1. 초기 sync 신호(sync)는 무시. exists만 처리.
  const resourceState = req.headers.get('X-Goog-Resource-State')
  if (resourceState === 'sync') return new Response('ok', { status: 200 })

  const channelId = req.headers.get('X-Goog-Channel-ID')
  const channelToken = req.headers.get('X-Goog-Channel-Token')
  if (!channelId) return new Response('Bad Request', { status: 400 })

  // 2. service_role로 channel_id → user_id, calendar_id, last_sync_at 조회
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: channel } = await serviceClient
    .from('google_watch_channels')
    .select('user_id, calendar_id, last_sync_at, channel_id')
    .eq('channel_id', channelId)
    .single()

  if (!channel) return new Response('Not Found', { status: 404 })

  // 2-1. X-Goog-Channel-Token 검증 — 채널 등록 시 token=channel_id로 설정했으므로 일치 확인
  //      DoS 완화: 유효하지 않은 token이면 sync 실행 없이 즉시 거부
  if (channelToken !== channel.channel_id) {
    return new Response('Forbidden', { status: 403 })
  }

  // 3. user_tokens에서 refresh_token 복호화 → access_token 발급
  //    (refresh-google-token Edge Function의 decryptToken 로직 재사용)
  const { data: tokenRow } = await serviceClient
    .from('user_tokens')
    .select('provider_refresh_token')
    .eq('user_id', channel.user_id)
    .single()

  const refreshToken = await decryptToken(tokenRow.provider_refresh_token, SERVICE_ROLE_KEY)
  const accessToken = await fetchAccessToken(refreshToken, CLIENT_ID, CLIENT_SECRET)

  // 4. updatedMin = last_sync_at - 60초 (60s 오버랩 윈도우)
  //    경계 구간 이벤트 누락 방지: fetch 처리 중 발생한 변경을 다음 사이클에서 재확인
  //    60초 중복 fetch는 upsert 멱등성으로 안전하게 흡수됨
  const updatedMin = channel.last_sync_at
    ? new Date(new Date(channel.last_sync_at).getTime() - 60_000).toISOString()
    : undefined  // 최초 sync는 full fetch
  const gEvents = await fetchGoogleEventsServer(
    accessToken,
    channel.calendar_id,
    updatedMin
  )

  // 5. upsert / delete
  const toUpsert = []
  const toDelete = []
  for (const ev of gEvents) {
    if (ev.status === 'cancelled') toDelete.push(ev.id)
    else {
      const mapped = mapGoogleEventToRiff(ev, channel.calendar_id, /* color */)
      if (mapped) toUpsert.push(mapped)
    }
  }
  await bulkUpsertEventsServer(serviceClient, channel.user_id, toUpsert)
  await bulkDeleteEventsServer(serviceClient, channel.user_id, toDelete, channel.calendar_id)

  // 6. last_sync_at 갱신 (fetch 완료 시각으로 커서 전진)
  await serviceClient
    .from('google_watch_channels')
    .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('channel_id', channelId)

  // 7. Realtime Broadcast → 브라우저에 즉시 반영 신호
  await serviceClient
    .channel(`google-webhook-${channel.user_id}`)
    .send({
      type: 'broadcast',
      event: 'sync-complete',
      payload: { calendarId: channel.calendar_id }
    })

  return new Response('ok', { status: 200 })
})
```

**색상 처리 문제**: Edge Function은 `calendar_metadata` 테이블에서 색상을 조회해야 함.
```typescript
const { data: calMeta } = await serviceClient
  .from('calendar_metadata')
  .select('color')
  .eq('user_id', channel.user_id)
  .eq('google_calendar_id', channel.calendar_id)
  .single()
const color = calMeta?.color ?? '#4285F4'
```

---

## 4. Edge Function — google-watch-register

### 파일: `supabase/functions/google-watch-register/index.ts`

**역할**: 클라이언트(또는 Cron)에서 호출. Google Watch 채널 등록/갱신.

**요청 형식**:
```typescript
// 클라이언트 → Edge Function (user JWT)
{
  calendarIds: string[]   // 등록할 캘린더 ID 목록
}

// Cron → Edge Function (service_role JWT만 허용)
{
  renewAll: true          // 만료 임박 채널 전체 갱신
}
```

**처리 로직**:

```typescript
serve(async (req) => {
  const body = await req.json()

  // renewAll은 service_role JWT 전용 — 일반 유저 호출 차단
  // Supabase JWT의 role claim으로 구분
  if (body.renewAll) {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
    const payload = JSON.parse(atob(jwt!.split('.')[1]))
    if (payload.role !== 'service_role') {
      return new Response('Forbidden', { status: 403 })
    }
    await renewExpiringChannels()
    return new Response('ok', { status: 200 })
  }

  // 클라이언트 요청: user JWT로 본인 캘린더만 등록 가능
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization')! } }
  })
  const { data: { user } } = await supabaseClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  for (const calendarId of body.calendarIds ?? []) {
    const accessToken = await getAccessTokenForUser(user.id)
    await registerChannelForCalendar(user.id, accessToken, calendarId)
  }
  return new Response('ok', { status: 200 })
})

// 채널 등록 함수
const registerChannelForCalendar = async (
  userId: string,
  accessToken: string,
  calendarId: string
) => {
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const newChannelId = crypto.randomUUID()
  const webhookUrl = `${SUPABASE_URL}/functions/v1/google-calendar-webhook`

  // 기존 채널 조회 → stop 후 재등록 (중복 webhook 방지)
  const { data: existing } = await serviceClient
    .from('google_watch_channels')
    .select('channel_id, resource_id')
    .eq('user_id', userId)
    .eq('calendar_id', calendarId)
    .single()

  if (existing?.resource_id) {
    // Google channels.stop 호출 — 기존 채널 즉시 해제
    await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: existing.channel_id, resourceId: existing.resource_id })
    }).catch(() => {/* 이미 만료된 채널은 무시 */})
  }

  // Google /watch 호출
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newChannelId,
        type: 'web_hook',
        address: webhookUrl,
        token: newChannelId,  // X-Goog-Channel-Token 검증용 (webhook 수신 시 비교)
      })
    }
  )

  if (!res.ok) throw new Error(`Watch registration failed: ${res.status}`)

  const data = await res.json()

  // DB upsert (기존 row 교체)
  await serviceClient
    .from('google_watch_channels')
    .upsert({
      user_id: userId,
      calendar_id: calendarId,
      channel_id: newChannelId,
      resource_id: data.resourceId,
      expiry: new Date(Number(data.expiration)).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,calendar_id' })
}

// Cron 갱신 함수
const renewExpiringChannels = async () => {
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 만료 24시간 이내 채널 조회
  const { data: expiring } = await serviceClient
    .from('google_watch_channels')
    .select('user_id, calendar_id')
    .lt('expiry', new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())

  for (const ch of expiring ?? []) {
    const accessToken = await getAccessTokenForUser(ch.user_id)
    await registerChannelForCalendar(ch.user_id, accessToken, ch.calendar_id)
  }
}
```

---

## 5. 채널 자동 갱신 — Supabase Cron

### Supabase Dashboard에서 직접 등록

**Dashboard > Database > Cron Jobs > New Cron Job**

| 항목 | 값 |
|------|-----|
| Name | `renew-google-watch-channels` |
| Schedule | `0 3 * * *` (매일 UTC 03:00) |
| Type | Edge Function |
| Function | `google-watch-register` |
| Body | `{"renewAll": true}` |

Dashboard Cron은 내부적으로 service_role JWT를 자동 첨부하므로 별도 키 관리 불필요.

> **pg_cron + current_setting 방식을 사용하지 않는 이유**:
> `current_setting('app.service_role_key')` 같은 DB custom setting은 별도 주입이 필요하고,
> service_role key를 DB 설정값으로 관리하면 키 회전 및 노출 위험이 생김.
> Dashboard Cron이 이 문제를 모두 해결해주는 권장 방식.

---

## 6. 클라이언트 변경 — DataContext

### 변경 1: 채널 등록 — syncGoogleCalendar 내부

`src/contexts/DataContext.tsx`의 `syncGoogleCalendar` 함수에서
캘린더 sync 성공 후 채널 등록 호출 추가:

```typescript
// 기존 sync 성공 직후 (lastSyncTimesRef 갱신 이후)
lastSyncTimesRef.current[calId] = new Date().toISOString()
saveGoogleLastSyncTimes(lastSyncTimesRef.current)

// ← 여기에 추가
void registerGoogleWatchChannel(token, calId)  // 백그라운드, 에러 무시
```

```typescript
// src/lib/googleCalendar.ts 에 추가
export const registerGoogleWatchChannel = async (
  token: string,
  calendarId: string
): Promise<void> => {
  try {
    await supabase.functions.invoke('google-watch-register', {
      body: { calendarIds: [calendarId] }
    })
  } catch (e) {
    console.warn('[Google Watch] 채널 등록 실패 (폴링으로 fallback):', e)
  }
}
```

### 변경 2: Realtime Broadcast 구독 추가

`src/contexts/DataContext.tsx`의 Realtime useEffect에 Broadcast 구독 추가:

```typescript
// 기존 supabase Realtime 채널에 추가
.on('broadcast', { event: 'sync-complete' }, (payload) => {
  // 이 유저의 신호인지 확인 (채널 자체가 userId 기반이므로 추가 검증 불필요)
  console.log('[Google Webhook] 변경 감지 → 즉시 로드', payload)
  loadData(true)
})
```

실제 채널 구독:
```typescript
// 기존 'riff-realtime' 채널 외에 별도 채널로 구독
// (broadcast는 Realtime postgres_changes와 별도 채널 권장)
const webhookChannel = supabase
  .channel(`google-webhook-${session?.user?.id}`)
  .on('broadcast', { event: 'sync-complete' }, () => {
    if (selectedGoogleIdsRef.current.length > 0) {
      loadData(true)
    }
  })
  .subscribe()

return () => supabase.removeChannel(webhookChannel)
```

이 구독은 `selectedGoogleCalendarIds`가 있을 때만 활성화. **Broadcast 핸들러에 300ms 디바운스 적용** — Google에서 변경이 연속 발생할 때 `loadData(true)` 중복 호출 방지:

```typescript
useEffect(() => {
  if (!session?.user?.id || selectedGoogleCalendarIds.length === 0) return

  let broadcastDebounce: ReturnType<typeof setTimeout>

  const channel = supabase
    .channel(`google-webhook-${session.user.id}`)
    .on('broadcast', { event: 'sync-complete' }, () => {
      clearTimeout(broadcastDebounce)
      broadcastDebounce = setTimeout(() => loadData(true), 300)
    })
    .subscribe()

  return () => {
    clearTimeout(broadcastDebounce)
    supabase.removeChannel(channel)
  }
}, [session?.user?.id, selectedGoogleCalendarIds.length > 0])
```

> **디바운스가 필요한 이유**: Google에서 이벤트를 여러 개 수정하면 변경마다 Webhook이 발화되어 Broadcast가 연속 수신될 수 있음. 디바운스 없이는 `loadData(true)`가 연속 호출되어 불필요한 DB 왕복 발생. 300ms는 §11-2의 events Realtime 디바운스와 동일한 기준.

### 변경 3: last_sync_at 발산 방지 (선택적 최적화)

Webhook의 DB `last_sync_at`과 클라이언트 localStorage `lastSyncTimesRef`는 독립적으로 관리됨.
발산 시 중복 fetch가 발생하지만 upsert 멱등성으로 **데이터 무결성은 보장**됨.

최적화가 필요하다면 Broadcast 수신 시 localStorage도 갱신:

```typescript
.on('broadcast', { event: 'sync-complete' }, (payload) => {
  clearTimeout(broadcastDebounce)
  broadcastDebounce = setTimeout(() => {
    // localStorage lastSyncTimesRef도 현재 시각으로 갱신 → 다음 폴링의 중복 fetch 최소화
    if (payload.payload?.calendarId) {
      lastSyncTimesRef.current[payload.payload.calendarId] = new Date().toISOString()
      saveGoogleLastSyncTimes(lastSyncTimesRef.current)
    }
    loadData(true)
  }, 300)
})
```

> **1차 구현에서는 생략 가능** — 중복 fetch는 성능 낭비일 뿐 버그가 아님.

### 변경 5: 로그아웃 시 채널 해제 (선택적)

로그아웃 시 Google Watch 채널을 Google에서 명시적으로 해제하면 불필요한 webhook 수신 방지.
구현 복잡도 대비 효과가 적으므로 **1차 구현에서는 생략** — DB의 채널은 7일 후 자연 만료.

---

## 7. 보안

### Webhook 검증 (2중 검증)

| 검증 단계 | 방법 | 목적 |
|-----------|------|------|
| 1차 | `X-Goog-Channel-ID` → DB 조회 | 등록된 채널인지 확인 |
| 2차 | `X-Goog-Channel-Token` vs DB `channel_id` 비교 | DoS 완화 — 값이 다르면 sync 실행 없이 403 |

채널 등록 시 `token: newChannelId`로 설정 → Google이 webhook 요청마다 `X-Goog-Channel-Token`에 이 값을 그대로 전달 → Edge Function에서 DB의 `channel_id`와 비교.

channel_id는 UUID라 추측 불가능하지만, 2중 검증으로 방어 깊이를 확보함.

### renewAll 권한 제어

`renewAll: true` 요청은 **service_role JWT에서만 허용**.
Supabase JWT의 `role` claim이 `service_role`이 아니면 즉시 403 반환.
일반 유저 JWT로는 본인 캘린더 등록(`calendarIds`)만 가능.

### service_role_key 사용 범위

webhook · watch-register Edge Function은 `service_role`로 DB 접근 (RLS 우회 필요).
기존 `refresh-google-token`, `caldav-proxy`와 동일한 패턴.
service_role key는 Edge Function 환경변수에만 존재 — DB 설정값이나 클라이언트에 노출 금지.

### Webhook URL 노출

`https://<project>.supabase.co/functions/v1/google-calendar-webhook`은 공개 URL.
2중 검증(channel_id DB 조회 + Channel-Token 비교)으로 임의 POST 차단.

---

## 8. 구현 순서

| 단계 | 작업 | 파일 |
|------|------|------|
| 1 | DB 마이그레이션 | `supabase/migrations/20260403_add_google_watch_channels.sql` |
| 2 | `google-calendar-webhook` Edge Function 구현 | `supabase/functions/google-calendar-webhook/index.ts` |
| 3 | `google-watch-register` Edge Function 구현 | `supabase/functions/google-watch-register/index.ts` |
| 4 | Edge Functions 배포 및 Webhook URL 테스트 | `supabase functions deploy` |
| 5 | DataContext — `registerGoogleWatchChannel` 호출 추가 | `src/contexts/DataContext.tsx` |
| 6 | DataContext — Broadcast 구독 추가 | `src/contexts/DataContext.tsx` |
| 7 | `src/lib/googleCalendar.ts` — 헬퍼 함수 추가 | `src/lib/googleCalendar.ts` |
| 8 | Cron 설정 | Dashboard 또는 migration |
| 9 | E2E 테스트 | 아래 참고 |

### E2E 테스트 시나리오

```
[기본 동작]
1. Google 캘린더 연결 → DB에 google_watch_channels 행 생성 확인
   (channel_id, resource_id, expiry, token 필드 모두 채워졌는지 확인)
2. Google Calendar에서 이벤트 제목 수정
3. Riff 웹 브라우저 콘솔에서 '[Google Webhook] 변경 감지' 로그 확인
4. Riff UI에 제목이 즉시 반영되는지 확인 (5분 기다리지 않음)
5. Google Calendar에서 이벤트 삭제 → Riff에서 즉시 사라지는지 확인
6. google_watch_channels 테이블에서 last_sync_at 갱신 확인

[보안 검증]
7. renewAll: true를 일반 user JWT로 호출 → 403 응답 확인
8. X-Goog-Channel-Token 값을 임의로 변조한 POST → 403 응답 확인
9. 존재하지 않는 channel_id로 POST → 404 응답 확인

[채널 갱신]
10. 캘린더 재연결(동일 calendarId) → DB에서 channel_id가 교체됐는지 확인
    (기존 channel_id로 webhook POST 시 404 반환 확인 — 구 채널 stop 검증)
11. Cron 수동 실행(renewAll) → 만료 임박 채널 갱신 확인

[동시성]
12. Google에서 이벤트 5개 연속 수정 → Broadcast 디바운스로 loadData 1회만 호출 확인
```

### Fallback

- Watch 채널 등록 실패 → 기존 5분 폴링으로 자동 fallback (에러 무시)
- Webhook 수신 실패 → 다음 폴링 주기에 catch-up
- Edge Function 일시 장애 → Google이 재시도 (최대 수 회)

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `supabase/functions/google-calendar-webhook/index.ts` | 신규 — Google Webhook 수신 |
| `supabase/functions/google-watch-register/index.ts` | 신규 — 채널 등록/갱신 |
| `supabase/functions/refresh-google-token/index.ts` | 기존 — decryptToken 로직 참조 |
| `src/contexts/DataContext.tsx` | 수정 — 채널 등록 호출 + Broadcast 구독 |
| `src/lib/googleCalendar.ts` | 수정 — registerGoogleWatchChannel 추가 |
| `supabase/migrations/20260403_add_google_watch_channels.sql` | 신규 — DB 테이블 |
