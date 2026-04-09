# Google/iCloud 동기화 UX 통합 구현 계획

## Context

Riff에 Apple 로그인 + Google Calendar 동기화 조합이 동작하지 않는 문제를 수정하면서,
Google/iCloud 동기화 아이콘과 팝업 흐름을 체계적으로 재설계한다.

**핵심 문제:**
- Apple 로그인 유저는 `hasGoogleProvider=false` → `getGoogleProviderToken()` null 반환 → Google Calendar 인증 불가
- 기존 UX: 로그인 방식(Google/Apple)에 관계없이 모든 유저가 동일한 "계정연결 팝업"을 거침 → 불필요

**해결 방향:**
1. Apple 로그인 유저도 별도 Google OAuth 연동 가능 (Edge Function 기반) — **#42에서 완료**
2. 인증이 완료된 유저는 계정연결 팝업 없이 바로 캘린더 선택으로 진입
3. 인증 오류 시만 cloud_off + 재인증 팝업 노출

---

## Alert 아이콘 분석 (변경 없음)

`CalendarListPopup.tsx:196-213`의 Riff 생성 캘린더(`createdFromApp=true`) 아이콘:
- `iCloud_alert.png`: `isCalDAVAuthError=true` 시 → `cloud_off`와 동일 조건 ✅
- `google_alert.png`: `isGoogleTokenExpired=true` 시 → `cloud_off`와 동일 조건 ✅

섹션 헤더 `cloud_off` ↔ 개별 아이템 alert 아이콘이 일치하므로 **변경 불필요**.

---

## 아이콘 상태 모델

### Google (3상태)
| 조건 | 아이콘 | 클릭 시 |
|---|---|---|
| `isGoogleTokenExpired=true` OR (미연동 && OAuth 미완료) | `cloud_off` | 계정연결 팝업 (에러 안내 + 재인증 버튼) |
| 연동됨 + `groups.google.length === 0` | `cloud` | 바로 캘린더 선택 팝업 |
| 연동됨 + `groups.google.length > 0` | `cloud_sync` | 바로 캘린더 선택 팝업 |

### iCloud (2상태)
| 조건 | 아이콘 | 클릭 시 |
|---|---|---|
| 자격증명 없음 OR 인증오류 OR 미동기화 | `cloud_off` | 자격증명 입력 폼 |
| 자격증명 있음 + 동기화 완료 | `cloud_sync` | 바로 캘린더 선택 팝업 |

---

## 모든 경우의 수 (시나리오)

### Google 시나리오

**G1. Google 로그인 유저, 캘린더 미동기화**
- 조건: `hasGoogleProvider=true`, `isGoogleTokenExpired=false`, `groups.google.length=0`
- 아이콘: `cloud`
- 클릭: 계정연결 팝업 없이 바로 캘린더 선택 팝업 (자동 handleGoToSelection)

**G2. Google 로그인 유저, 동기화 완료**
- 조건: `hasGoogleProvider=true`, `isGoogleTokenExpired=false`, `groups.google.length>0`
- 아이콘: `cloud_sync`
- 클릭: 바로 캘린더 선택 팝업

**G3. Google 로그인 유저, 토큰 만료**
- 조건: `isGoogleTokenExpired=true`
- 아이콘: `cloud_off`
- 클릭: 계정연결 팝업 → 에러 안내 + "Google 계정 연결" 버튼
- 재인증 성공 → `cloud_off` 해제 → `cloud` 아이콘 즉시 반영 → 캘린더 선택 자동 진입

**G4. Apple 로그인 유저, Google OAuth 미연동**
- 조건: `hasGoogleProvider=false`, `isGoogleOAuthConnected=false`
- 아이콘: `cloud_off`
- 클릭: 계정연결 팝업 → "Google 계정 연결" 버튼 → OAuth flow

**G5. Apple 로그인 유저, Google OAuth 완료, 미동기화**
- 조건: `hasGoogleProvider=false`, `isGoogleOAuthConnected=true`, `groups.google.length=0`
- 아이콘: `cloud`
- 클릭: 바로 캘린더 선택 팝업

**G6. Apple 로그인 유저, Google OAuth 완료, 동기화 완료**
- 조건: `hasGoogleProvider=false`, `isGoogleOAuthConnected=true`, `groups.google.length>0`
- 아이콘: `cloud_sync`
- 클릭: 바로 캘린더 선택 팝업

**G7. Apple 로그인 유저, Google OAuth 완료, 토큰 만료**
- 조건: `isGoogleOAuthConnected=true`, `isGoogleTokenExpired=true`
- 아이콘: `cloud_off`
- 클릭: 계정연결 팝업 → 재인증 → `cloud` + 캘린더 선택 자동 진입

**G8. 캘린더 선택에서 0개 선택 + 동기화**
- 동작: `onDisconnect()` 즉시 호출 (확인 없음) → 전체 해제 → `cloud` 아이콘

### iCloud 시나리오

**C1. 자격증명 없음 (신규 유저)**
- 조건: `isCalDAVCredentialsSaved=false`
- 아이콘: `cloud_off`
- 클릭: 자격증명 입력 폼 (빈 폼)

**C2. 자격증명 저장됨, 미동기화**
- 조건: `isCalDAVCredentialsSaved=true`, `isCalDAVAuthError=false`, CalDAV 캘린더 없음
- 아이콘: `cloud_off`
- 클릭: 자격증명 폼 (pre-filled) → "iCloud 캘린더 연결" → 캘린더 선택

**C3. 자격증명 저장됨, 동기화 완료**
- 조건: `isCalDAVCredentialsSaved=true`, `isCalDAVAuthError=false`, CalDAV 캘린더 있음
- 아이콘: `cloud_sync`
- 클릭: 바로 캘린더 선택 팝업 (자격증명 검증 + 자동 로드)
- CalDAV 서버 응답 실패 시: 자격증명 폼으로 리다이렉트 + 에러 안내

**C4. 자격증명 저장됨, 인증오류**
- 조건: `isCalDAVAuthError=true`
- 아이콘: `cloud_off`
- 클릭: 자격증명 폼 (에러 안내 메시지 포함)

**C5. 캘린더 선택에서 0개 선택 + 동기화**
- 동작: `handleSwitchDisconnect()` 즉시 호출 (확인 없음) → 전체 해제 → `cloud_off` 아이콘

---

## 구현 파일 및 변경 상세

### Step 1: `src/lib/googleCalendar.ts`

**`setCachedGoogleToken()` (line 121~126)에 localStorage 세팅 추가:**
```typescript
export const setCachedGoogleToken = (token: string, expiresIn: number) => {
  cachedToken = token;
  cachedTokenExpiry = Date.now() + (expiresIn - 60) * 1000;
  edgeFunctionFailed = false;
  edgeFunctionRetryAt = 0;
  localStorage.setItem('googleOAuthConnected', 'true');  // ← NEW
};
```

### Step 2: `src/App.tsx`

**`USER_SCOPED_LS_KEYS` 배열에 추가 (line 33~41 근처):**
```typescript
'googleOAuthConnected',  // ← NEW (유저 전환 시 자동 초기화)
```

**`isGoogleAuthEvent` 분기 (line 92~96)에 플래그 세팅 추가:**
```typescript
if (isGoogleAuthEvent) {
  if (session.provider_refresh_token) {
    saveGoogleRefreshToken(...).catch(console.error);
  }
  localStorage.setItem('googleOAuthConnected', 'true');  // ← NEW
}
```

### Step 3: `src/contexts/DataContext.tsx`

**`syncGoogleCalendar` 토큰 만료 감지 (line 254~263) - Apple OAuth 유저 포함:**
```typescript
// 변경 전
if (hasGoogleProvider) { ... setIsGoogleTokenExpired(true); }

// 변경 후
const isGoogleOAuthConnected = localStorage.getItem('googleOAuthConnected') === 'true';
if (hasGoogleProvider || isGoogleOAuthConnected) {
  localStorage.setItem('googleTokenExpired', 'true');
  setIsGoogleTokenExpired(true);
}
```

### Step 4: `src/components/MainLayout.tsx`

**`isGoogleOAuthConnected` state 추가 (line 315 근처):**
```typescript
const [isGoogleOAuthConnected, setIsGoogleOAuthConnected] = useState(
  () => localStorage.getItem('googleOAuthConnected') === 'true'
);
```

**`handleGoogleDisconnect` 수정 (line 1215~1228):**
```typescript
// 추가
localStorage.removeItem('googleOAuthConnected');
setIsGoogleOAuthConnected(false);
clearGoogleTokenExpiredFlag();
// 의존성에 clearGoogleTokenExpiredFlag 추가
```

**`handleGoogleSyncComplete` 수정 (line ~1200 근처):**
```typescript
setIsGoogleOAuthConnected(true);  // ← NEW (재인증 성공 후 즉시 state 갱신)
```

**`isCalDAVSyncOnOpen` 계산 추가:**
```typescript
const isCalDAVSyncOnOpen =
  calendarMetadata.some(c => isCalDAVSyncTarget(c))
  && !isCalDAVAuthError
  && isCalDAVCredentialsSaved;
```

**`isGoogleConnectedForModal` 계산 추가:**
```typescript
const isGoogleConnectedForModal =
  !isGoogleTokenExpired && (hasGoogleProvider || isGoogleOAuthConnected);
```

**CalendarListPopup에 props 추가:**
```typescript
isGoogleOAuthConnected={isGoogleOAuthConnected}
```

**AppModals에 props 추가:**
```typescript
googleSyncIsConnectedOnOpen={isGoogleConnectedForModal}
calDAVIsCloudSyncOnOpen={isCalDAVSyncOnOpen}
calDAVIsAuthError={isCalDAVAuthError}
```

### Step 5: `src/components/AppModals.tsx`

**`AppModalsProps` interface에 추가:**
```typescript
googleSyncIsConnectedOnOpen?: boolean;  // ← NEW
calDAVIsCloudSyncOnOpen?: boolean;      // ← NEW
calDAVIsAuthError?: boolean;            // ← NEW
```

**GoogleSyncModal 렌더링에 props 전달:**
```typescript
isConnectedOnOpen={googleSyncIsConnectedOnOpen}
```

**CalDAVSyncModal 렌더링에 props 전달:**
```typescript
isCloudSyncOnOpen={calDAVIsCloudSyncOnOpen}
isAuthError={calDAVIsAuthError}
```

### Step 6: `src/components/CalendarListPopup.tsx`

**interface에 `isGoogleOAuthConnected` 추가 (line 25 근처):**
```typescript
isGoogleOAuthConnected?: boolean;
```

**destructuring에 추가 (line 231 근처):**
```typescript
isGoogleOAuthConnected = false,
```

**`isGoogleCloudOff` 조건 변경 (line 390):**
```typescript
// 변경 전
const isGoogleCloudOff = (!hasGoogleProvider && groups.google.length === 0) || isGoogleTokenExpired;

// 변경 후
const isGoogleCloudOff =
  (!hasGoogleProvider && !isGoogleOAuthConnected && groups.google.length === 0)
  || isGoogleTokenExpired;
```

**Google 아이콘 3상태 렌더링 변경 (line 494):**
```typescript
// 변경 전
>{isSyncingGoogle ? 'sync' : isGoogleCloudOff ? 'cloud_off' : 'cloud_sync'}<

// 변경 후
>{isSyncingGoogle ? 'sync' : isGoogleCloudOff ? 'cloud_off' : groups.google.length > 0 ? 'cloud_sync' : 'cloud'}<
```

### Step 7: `src/components/GoogleSyncModal.tsx`

**props 추가:**
```typescript
interface GoogleSyncModalProps {
  ...
  isConnectedOnOpen?: boolean;  // ← NEW
}
```

**mount init() 내 자동 진입 (line 180~188 이후):**
```typescript
const handleGoToSelectionRef = useRef(handleGoToSelection);
useEffect(() => { handleGoToSelectionRef.current = handleGoToSelection; }, [handleGoToSelection]);

// init() 내, loadConnectedAccount() 이후 auth-only 분기 다음에 추가:
if (isConnectedOnOpen && token && mode === 'sync') {
  await handleGoToSelectionRef.current();
  return;
}
```

**`handleSync()` 0개 선택 처리 변경 (line 261~265):**
```typescript
// 변경 전
if (selectedIds.size === 0) {
  setError('동기화할 캘린더를 선택해주세요.');
  return;
}

// 변경 후
if (selectedIds.size === 0) {
  onDisconnect();  // 전체 해제
  return;
}
```

### Step 8: `src/components/CalDAVSyncModal.tsx`

**props 추가:**
```typescript
interface CalDAVSyncModalProps {
  ...
  isCloudSyncOnOpen?: boolean;  // ← NEW
  isAuthError?: boolean;        // ← NEW
}
```

**`settingsLoaded` 플래그 추가:**
```typescript
const [settingsLoaded, setSettingsLoaded] = useState(false);
// loadSettings useEffect 완료 시 setSettingsLoaded(true) 추가
```

**자동 selection 진입 useEffect 추가:**
```typescript
useEffect(() => {
  if (!settingsLoaded) return;
  if (isCloudSyncOnOpen && hasSavedPassword && isEnabled && !isAuthError) {
    void handleFetchCalendars(); // 성공 시 setStep('selection'), 실패 시 credentials에서 에러 표시
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [settingsLoaded]);
```

**`handleSync()` 0개 선택 처리 변경 (line 252~256):**
```typescript
// 변경 전
if (selectedCalendars.size === 0) {
  setError('동기화할 캘린더를 선택해주세요.');
  return;
}

// 변경 후
if (selectedCalendars.size === 0) {
  void handleSwitchDisconnect();  // 전체 해제 → cloud_off
  return;
}
```

---

## 구현 순서 (의존성 기준)

```
Step 1: googleCalendar.ts      (독립)
Step 2: App.tsx                (독립)
Step 3: DataContext.tsx        (독립, localStorage만 참조)
Step 4: MainLayout.tsx         (Step 1~3 state 통합)
Step 5: AppModals.tsx          (Step 4 props 수신)
Step 6: CalendarListPopup.tsx  (Step 4 props 수신)
Step 7: GoogleSyncModal.tsx    (Step 5 props 수신)
Step 8: CalDAVSyncModal.tsx    (Step 5 props 수신)
```

---

## 검증 시나리오

### Google
| # | 전제 | 확인 항목 |
|---|---|---|
| G1 | Google 로그인, 미동기화 | `cloud` 아이콘, 클릭 시 계정연결 팝업 없이 바로 캘린더 선택 |
| G2 | Google 로그인, 동기화 완료 | `cloud_sync` 아이콘, 클릭 시 바로 캘린더 선택 |
| G3 | `localStorage.setItem('googleTokenExpired','true')` 강제 세팅 | `cloud_off`, 클릭→팝업→재인증→`cloud`+캘린더 선택 자동 |
| G4 | Apple 로그인, Google OAuth 없음 | `cloud_off`, 클릭→계정연결 팝업→OAuth 버튼 |
| G5 | Apple 로그인, OAuth 완료, 미동기화 | `cloud` 아이콘 |
| G6 | Apple 로그인, OAuth 완료, 동기화 완료 | `cloud_sync` 아이콘 |
| G7 | Apple 로그인, OAuth 완료 후 `googleTokenExpired` 강제 세팅 | `cloud_off`→재인증→`cloud` |
| G8 | 동기화 상태에서 캘린더 선택 0개 + 동기화 | 즉시 전체 해제, `cloud` 복귀, toast 표시 |
| G-alert | `isGoogleTokenExpired=true` 상태에서 Riff→Google 캘린더 존재 | `google_alert.png` 표시 |

### iCloud
| # | 전제 | 확인 항목 |
|---|---|---|
| C1 | 자격증명 없음 | `cloud_off`, 클릭→빈 자격증명 폼 |
| C2 | 자격증명 저장됨, 미동기화 | `cloud_off`, 클릭→pre-filled 폼 |
| C3 | 동기화 완료 | `cloud_sync`, 클릭→캘린더 선택 자동 로드 |
| C3-err | 동기화 완료 상태에서 CalDAV 서버 인증 실패 | credentials 폼으로 리다이렉트 + 에러 표시 |
| C4 | `localStorage.setItem('caldavAuthError','true')` 강제 | `cloud_off` + `iCloud_alert.png` |
| C5 | 동기화 상태에서 캘린더 선택 0개 + 동기화 | 즉시 전체 해제, `cloud_off` 복귀, toast 표시 |

---

## 참조 함수 (재사용)

- `deleteAllGoogleData()` — `src/services/api.ts` (Google 전체 해제)
- `handleSwitchDisconnect()` — `CalDAVSyncModal.tsx` (iCloud 전체 해제)
- `clearGoogleTokenExpiredFlag()` — `DataContext.tsx` (토큰 만료 플래그 제거)
- `isCalDAVSyncTarget()` — `src/services/calendarSyncUtils.ts` (CalDAV 캘린더 판별)
- `handleFetchCalendars()` — `CalDAVSyncModal.tsx` (자격증명 검증 + 캘린더 목록 로드)
- `handleGoToSelection()` — `GoogleSyncModal.tsx` (Google 캘린더 목록 로드 + step 전환)

---

## 주의 사항

1. **`isGoogleOAuthConnected` state 동기화**: `setCachedGoogleToken()`이 localStorage를 세팅하지만 React state는 자동 갱신 안 됨. `handleGoogleSyncComplete`에서 `setIsGoogleOAuthConnected(true)` 명시 필요.

2. **CalDAVSyncModal `handleFetchCalendars` 호출 시점**: settingsLoaded useEffect에서 호출 시 hasSavedPassword/isEnabled가 최신 값인지 확인. settingsLoaded가 true가 되는 시점에 이미 state가 세팅되어 있으므로 안전.

3. **0개 선택 해제 후 toast**: 기존 disconnect 함수들이 이미 toast를 표시하므로 별도 추가 불필요.
