# Google Calendar OAuth 독립 플로우 구현 (PR #42)

## 배경 및 문제

Apple 로그인으로 Riff에 로그인한 유저가 Google Calendar 동기화를 시도할 때 인증이 불가능했다.

**근본 원인:**

`getGoogleProviderToken()` 내부에서 `hasGoogleProvider` 조건을 가장 먼저 체크했다.

```typescript
// 기존 코드 (문제)
const hasGoogleProvider =
  session?.user?.app_metadata?.providers?.includes('google') ||
  session?.user?.app_metadata?.provider === 'google';
if (!hasGoogleProvider) return null;  // ← Apple 로그인 유저는 여기서 즉시 차단
```

Apple 로그인 유저는 Supabase `app_metadata`에 Google provider가 없으므로 항상 `null` 반환 → Google Calendar API 호출 불가.

**시도했다가 포기한 방식: `supabase.auth.linkIdentity(google)`**

Google 계정을 Supabase identity에 연결하는 방식. 이미 Apple로 로그인된 상태에서 Google을 추가 provider로 연결하는 개념이다. 포기한 이유:
- `identity_already_exists` 에러가 빈번하게 발생
- linkIdentity는 "추가 로그인 수단 연결"이 목적이라 Google Calendar 권한(`calendar` scope) 획득에 깔끔하지 않음
- Supabase가 `provider_token`을 세션 갱신 시 유실하는 알려진 한계 존재

---

## 해결 방향: Edge Function 기반 독립 OAuth 플로우

Riff 앱의 로그인 방식(Apple/Google)과 **완전히 분리된** 별도 Google Calendar OAuth를 구현한다.

```
Notion에서 Google Calendar 연동하는 것과 동일한 구조:
"서비스 로그인" ≠ "외부 서비스 연결"
```

`client_id`/`client_secret`은 서버(Edge Function)에서만 관리하고,
발급받은 `refresh_token`은 `user_tokens` 테이블에 AES-GCM 암호화하여 저장한다.

---

## 구현 상세

### 1. Edge Function: `refresh-google-token` 에 액션 추가

**파일:** `supabase/functions/refresh-google-token/index.ts`

기존 Edge Function(refresh_token → access_token 갱신)에 두 가지 액션을 추가했다.

#### `getAuthUrl` 액션
클라이언트가 Google OAuth URL을 요청하면 서버에서 생성해 반환한다.
`client_id`가 서버에서만 사용되므로 클라이언트 코드에 노출되지 않는다.

```typescript
// POST { action: 'getAuthUrl', redirectUri: 'https://...' }
// → { url: 'https://accounts.google.com/o/oauth2/v2/auth?...' }

const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
url.searchParams.set('client_id', clientId);
url.searchParams.set('redirect_uri', redirectUri);
url.searchParams.set('response_type', 'code');
url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar');
url.searchParams.set('access_type', 'offline');
url.searchParams.set('prompt', 'consent');  // 매번 refresh_token 재발급 보장
```

#### `exchange` 액션
Google이 리다이렉트로 전달한 `authorization code`를 받아 토큰으로 교환한다.
`refresh_token`은 AES-GCM으로 암호화 후 `user_tokens` 테이블에 저장하고,
`access_token`만 클라이언트에 반환한다.

```typescript
// POST { action: 'exchange', code: '...', redirectUri: '...' }
// → { access_token: '...', expires_in: 3600 }

// refresh_token은 서버에서만 처리
const encrypted = await encryptToken(tokenData.refresh_token, serviceRoleKey);
await supabaseClient.from('user_tokens').upsert({
  user_id: user.id,
  provider_refresh_token: encrypted,
  updated_at: new Date().toISOString()
});
// access_token만 클라이언트에 반환
```

#### 기존 refresh 액션 (변경 없음)
액션 지정 없이 호출 시 `user_tokens`의 `refresh_token`으로 access_token을 갱신한다.
이 경로가 **Google 로그인 유저와 Apple+Google OAuth 연동 유저 모두에게** 공유된다.

---

### 2. `getGoogleProviderToken()` 개선

**파일:** `src/lib/googleCalendar.ts`

`hasGoogleProvider` 조기 반환을 제거하고 우선순위를 재구성했다.

```typescript
export const getGoogleProviderToken = async (): Promise<string | null> => {
  const { data: { session } } = await supabase.auth.getSession();
  const now = Date.now();

  // 1. Google OAuth 로그인 세션 → provider_token 사용
  //    (Apple의 provider_token과 혼용 방지를 위해 provider='google' 명시 체크)
  const isCurrentlyGoogleSession = session?.user?.app_metadata?.provider === 'google';
  if (isCurrentlyGoogleSession && session?.provider_token) {
    return session.provider_token;
  }

  // 2. 메모리 캐시 체크
  //    Apple+Google OAuth 유저가 setCachedGoogleToken()으로 세팅한 토큰도 여기서 반환
  if (cachedToken && cachedTokenExpiry > now) {
    return cachedToken;
  }

  // 3. Edge Function으로 갱신 시도
  //    - Google 로그인 유저: Supabase 내부 refresh_token 사용
  //    - Apple+Google OAuth 유저: user_tokens 테이블의 refresh_token 사용
  //    - Google 연동 없는 유저: 404 반환 → 10분 차단
  const { data, error } = await supabase.functions.invoke('refresh-google-token', { method: 'POST' });
  if (!error && data?.access_token) {
    cachedToken = data.access_token;
    cachedTokenExpiry = now + ((data.expires_in ?? 3300) - 60) * 1000;
    return cachedToken;
  }
  // ...
};
```

**핵심 변경:** `hasGoogleProvider` 조기 반환 제거로 Apple 유저도 2번(캐시), 3번(Edge Function) 경로에 도달 가능.

---

### 3. `setCachedGoogleToken()` 추가

**파일:** `src/lib/googleCalendar.ts`

`exchange` 완료 후 받은 `access_token`을 메모리 캐시에 직접 세팅하는 함수.
모달 → Edge Function 호출 → 캐시 세팅 → 이후 `getGoogleProviderToken()` 호출 시 캐시 히트.

```typescript
export const setCachedGoogleToken = (token: string, expiresIn: number) => {
  cachedToken = token;
  cachedTokenExpiry = Date.now() + (expiresIn - 60) * 1000;
  edgeFunctionFailed = false;
  edgeFunctionRetryAt = 0;
};
```

---

### 4. `GoogleSyncModal.tsx` 개편

**파일:** `src/components/GoogleSyncModal.tsx`

#### step 상태 추가
```typescript
const [step, setStep] = useState<'account' | 'selection'>('account');
```

#### OAuth 플로우 (미연결 상태)
"구글 계정 연결" 버튼 클릭 시:
1. `sessionStorage.setItem('googleLinkPending', '1')` 플래그 세팅
2. Edge Function `getAuthUrl` 호출
3. `window.location.href = url` 로 Google OAuth 페이지로 이동

#### OAuth 콜백 처리 (복귀 시)
모달 mount 시 `init()` 함수에서 자동으로 감지:
1. `sessionStorage.getItem('googleLinkPending') === '1'` 확인
2. URL `?code=` 파라미터 추출
3. Edge Function `exchange` 액션 호출
4. `setCachedGoogleToken(access_token, expires_in)` 으로 캐시 세팅
5. `setStep('selection')` 으로 캘린더 선택 단계 진입

#### MainLayout에서 리다이렉트 복귀 감지
```typescript
// MainLayout.tsx
useEffect(() => {
  if (sessionStorage.getItem('googleLinkPending') === '1') {
    clearGoogleTokenExpiredFlag();
    setIsGoogleSyncModalOpen(true);  // 모달 자동 오픈 → init()에서 처리
  }
}, []);
```

---

### 5. 기타 변경

#### `deleteAllCalDAVData()` 변경 (`src/services/api.ts`)
```typescript
// 변경 전: caldav_sync_settings row 삭제
// 변경 후: selected_calendar_urls/enabled 초기화 (자격증명 유지)
await supabase.from('caldav_sync_settings').update({
  selected_calendar_urls: [],
  last_sync_at: null,
  enabled: false,
}).eq('user_id', user.id);
```
→ iCloud 재연결 시 서버 URL/사용자명/비밀번호 재입력 불필요.

#### `deleteAllGoogleData()` 변경 (`src/services/api.ts`)
```typescript
// google_watch_channels도 함께 정리
await supabase.from('google_watch_channels').delete().eq('user_id', user.id);
```
→ 연동 해제 후 불필요한 웹훅 신호 방지.

---

## 토큰 갱신 흐름 요약

```
[Google 로그인 유저]
  getGoogleProviderToken()
    → provider='google' + provider_token 있음 → 즉시 반환
    → provider_token 소멸 후 → Edge Function → Supabase 내부 refresh_token 사용

[Apple 로그인 + Google OAuth 연동 유저]
  OAuth 완료 시:
    exchange → refresh_token을 user_tokens에 암호화 저장
             → access_token을 setCachedGoogleToken()으로 캐시
  이후 호출:
    getGoogleProviderToken()
      → 캐시 유효 → 캐시에서 반환
      → 캐시 만료 → Edge Function → user_tokens의 refresh_token 사용

[Google 연동 없는 유저]
  getGoogleProviderToken()
    → Edge Function 404 → edgeFunctionFailed=true → 10분 차단 → null 반환
```

---

## 관련 파일

| 파일 | 변경 내용 |
|---|---|
| `supabase/functions/refresh-google-token/index.ts` | `getAuthUrl`, `exchange` 액션 추가 |
| `src/lib/googleCalendar.ts` | `setCachedGoogleToken()` 추가, `getGoogleProviderToken()` 개선 |
| `src/components/GoogleSyncModal.tsx` | step 상태, OAuth 콜백 처리, 자동 exchange |
| `src/components/MainLayout.tsx` | `googleLinkPending` 복귀 감지, 모달 자동 오픈 |
| `src/services/api.ts` | `deleteAllCalDAVData()` 소프트 리셋, `deleteAllGoogleData()` 웹훅 정리 |
