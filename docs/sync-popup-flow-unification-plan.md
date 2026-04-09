---
name: sync-popup-flow-unification
overview: iCloud/Google 동기화 진입 UX를 동일하게 맞추기 위해, 계정연결 팝업을 항상 먼저 표시하고 OFF 스위치 기반 해제 흐름으로 통합합니다. 기존 컴포넌트 구조를 유지하며 step 상태 관리로 구현합니다.
todos:
  - id: caldav-modal-refactor
    content: CalDAVSyncModal — 자동 스킵 제거, 스위치 UI 추가, 버튼/제목 변경, disconnect 토스트화(window.location.reload 제거), caldavAuthError localStorage 정리 추가
    status: pending
  - id: google-modal-account-step
    content: GoogleSyncModal — account 단계 추가(step 상태), 자동 fetch 제거, 스위치 UI, 제목/버튼 변경
    status: pending
  - id: mainlayout-callbacks
    content: MainLayout — CalDAV onDisconnectSuccess 콜백 구현(excludeCalendarUrls 전달), Google disconnect confirm 제거
    status: pending
  - id: appmodals-props
    content: AppModals — 새 props(onDisconnectSuccess 등) 연결
    status: pending
  - id: css-switch
    content: CalDAVSyncModal.module.css / GoogleSyncModal.module.css — 스위치 행 및 account 단계 스타일 추가
    status: pending
  - id: risk-verify-webhook
    content: "[검증] Google 해제 후 google_watch_channels 정리 및 Broadcast 채널 동작 확인"
    status: pending
  - id: risk-verify-icon
    content: "[검증] CalDAV reload→loadData(true) 전환 후 cloud_off 아이콘 즉시 반영 확인"
    status: pending
  - id: risk-verify-cache
    content: "[검증] 해제 후 5분 TTL 캐시 stale 이벤트 미노출, excludeCalendarUrls 전달 여부 확인"
    status: pending
  - id: regression-check
    content: connected/disconnected x iCloud/Google 4가지 시나리오와 auth-only/reconnect 경로 수동 점검
    status: pending
isProject: false
---

# iCloud/Google 연동 UX 통합 계획

## Context

현재 iCloud(CalDAV)와 Google 캘린더의 연동 팝업 진입 흐름이 서로 다르다.
- **iCloud**: 연결됐을 때 → 자격증명 입력 폼 직접 오픈. 저장된 자격증명이 있으면 `credentials` 단계 자동 스킵 후 바로 selection 표시.
- **Google**: 연결됐을 때 → 캘린더 선택 팝업 직접 오픈. 계정연결 단계 없음.

목표: 두 서비스 모두 아이콘 클릭 시 **"계정연결" 팝업 → "캘린더 선택" 팝업** 순서로 통일. 연동 해제는 별도 버튼 대신 **ON/OFF 스위치**로 처리.

## 스위치 상태 원칙

스위치는 "계정연결" 팝업에 **항상** 표시되며, 연결 여부를 반영한다.
- **연결됨** → 스위치 ON (OFF로 토글 시 연동 해제 실행)
- **연결 끊김** → 스위치 OFF (읽기 전용 — 이미 연결 안 됨)

## 구현 접근

기존 계획의 "컴포넌트 완전 분리" 접근 대신 **기존 모달 내 step 상태 관리**로 구현.
- 기존 `CalDAVSyncModal`(step: credentials/selection)과 `GoogleSyncModal` 파일 유지
- 새 파일 생성 없음, 상태 전달 복잡도 최소화
- 기존 `auth-only` 재연결 경로 자동 호환

**핵심 수정 포인트:**
1. **CalDAV 자동 스킵 제거**: `hasSavedPassword` 시 `credentials` 단계를 건너뛰는 `useEffect` 제거
2. **`window.location.reload()` 제거**: CalDAV 해제 시 `reload()` → `loadData(true, excludeCalendarUrls)` 전환
3. **Google 자동 fetch 제거**: mount 시 자동 캘린더 목록 fetch 제거 → 버튼 클릭 시점으로 이동

---

## 경우의 수별 목표 UX

### iCloud (CalDAV)

#### 연결됨 (cloud_sync 클릭)
```
[계정연결] 팝업
  연동 해제(해제시 동기화된 캘린더 삭제)  [스위치 ●──ON]
  ─────────────────────────────────────
  서버 URL
  [https://caldav.icloud.com         ]

  사용자명
  [eulsoo@me.com                     ]

  앱 비밀번호
  [저장된 비밀번호 ●●●●●●●●           ]

  [이 암호를 안전하게 저장하기 ☑]

  [iCloud 캘린더 연결]
```
- 스위치 OFF: `deleteAllCalDAVData()` + localStorage 정리 + `loadData(true, 해제URL목록)` + 토스트 + 모달 닫기
- "iCloud 캘린더 연결" 클릭: 자격증명 검증 → "캘린더 선택" 팝업

#### 연결 끊김 (cloud_off 클릭)
```
[계정연결] 팝업
  연동 해제(해제시 동기화된 캘린더 삭제)  [──○ OFF]  ← 읽기 전용
  ─────────────────────────────────────
  서버 URL / 사용자명 / 앱 비밀번호 (편집 가능)

  [iCloud 캘린더 연결]
```
- 스위치 OFF는 읽기 전용
- "iCloud 캘린더 연결" 클릭: 자격증명 검증 → "캘린더 선택" 팝업

#### 캘린더 선택 팝업 (공통)
```
[캘린더 선택]  ← 제목 통일
  ☑ 전체 선택  /  ☑ 의민회민  /  ☑ 미팅1 ...
  [선택한 N개 캘린더 동기화]
```

---

### Google

#### 연결됨 (cloud_sync 클릭)
```
[계정연결] 팝업
  연동 해제(해제시 동기화된 캘린더 삭제)  [스위치 ●──ON]
  ─────────────────────────────────────
  연결된 계정: user@gmail.com

  [구글 캘린더 선택]
```
- 스위치 OFF: `handleGoogleDisconnect()` 즉시 실행(confirm 제거) → 토스트 → 모달 닫기
- "구글 캘린더 선택" 클릭: → "캘린더 선택" 팝업

#### 연결 끊김 (cloud_off 클릭)
```
[계정연결] 팝업
  연동 해제(해제시 동기화된 캘린더 삭제)  [──○ OFF]  ← 읽기 전용
  ─────────────────────────────────────
  [Google 계정 연결하기]   ← OAuth 버튼
```
- 스위치 OFF는 읽기 전용
- OAuth 완료(BroadcastChannel `google-oauth`) → `setStep('selection')` + `loadCalendars()`

---

## 파일별 구현 상세

### 1. `CalDAVSyncModal.tsx`

**a. 자동 스킵 제거** (현재 라인 111-123)
- `hasSavedPassword` 시 `handleFetchCalendars()`를 자동 호출하는 `useEffect` 제거
- 항상 `step === 'credentials'`부터 시작

**b. credentials 단계 UI 변경**
- 모달 제목: `"계정정보 입력"` → `"계정연결"`
- 서버 URL 위에 스위치 행 추가:
  - 레이블: `"연동 해제(해제시 동기화된 캘린더 삭제)"`
  - 스위치 상태: `hasSavedPassword && settingId` → ON / 아니면 OFF + disabled
  - OFF 핸들러 `handleSwitchDisconnect()`:
    - `deleteAllCalDAVData()`
    - `localStorage.removeItem('caldavAuthError')` ← **아이콘 상태 즉시 반영을 위해 필수**
    - `caldavSyncTokens:*` 패턴 localStorage 정리
    - `onDisconnectSuccess?.()` 호출
    - `onClose()`
    - `window.location.reload()` **완전 제거**
- "연동 해제 및 데이터 삭제" 버튼 제거
- 확인 버튼: `"확인"` → `"iCloud 캘린더 연결"`

**c. selection 단계:** 제목 → `"캘린더 선택"`

**d. Props 추가:** `onDisconnectSuccess?: () => void`

### 2. `GoogleSyncModal.tsx`

**a. step 상태 추가**
```tsx
const [step, setStep] = useState<'account' | 'selection'>('account');
```
- mount 시 자동 `loadCalendars()` 호출 제거

**b. account 단계 (신규)**

*연결됨 (`error !== 'require_auth'`):*
- 제목: `"계정연결"`, 계정 이메일: `supabase.auth.getSession()` → `session.user.email`
- 스위치 ON → OFF: `onDisconnect()` 즉시 호출 (confirm 제거)
- "구글 캘린더 선택" 버튼: `setStep('selection')` + `loadCalendars()`

*연결 안 됨 (`error === 'require_auth'`):*
- 제목: `"계정연결"`, 스위치 OFF + disabled
- 기존 OAuth 버튼 유지
- OAuth 완료 → `loadCalendars()` → 토큰 있으면 `setStep('selection')`

**c. selection 단계:** 제목 `"캘린더 선택"`, "연동 해제 및 데이터 삭제" 버튼 제거

### 3. `MainLayout.tsx`

```tsx
// onDisconnectSuccess 구현
const handleCalDAVDisconnectSuccess = useCallback(async () => {
  // 해제된 CalDAV 캘린더 URL 수집 후 excludeCalendarUrls로 전달
  setToast({ message: 'iCloud 연동이 해제되었습니다.', type: 'success' });
  await loadData(true);   // excludeCalendarUrls 전달 검토
  setIsCalDAVModalOpen(false);
}, [loadData]);
```

- `auth-only` 모드 경로 유지 (credentials 단계 → 자동 호환)
- `handleGoogleDisconnect`: confirm 다이얼로그 제거, 토스트만 유지

### 4. `AppModals.tsx` / CSS

- `CalDAVSyncModal`에 `onDisconnectSuccess` prop 전달
- 스위치 행 스타일 (flex, space-between), Google account 단계 레이아웃

---

## 4가지 우려사항 — 코드 분석 기반 점검

### ① Google Webhook 동기화 (Riff ← Google)

**현재 구조:**
- 웹훅 채널은 `DataContext.syncGoogleCalendar()` 내부 라인 366에서 `registerGoogleWatchChannel()` 호출로 등록
- 수신: Edge Function `google-calendar-webhook` → Supabase Realtime HTTP Broadcast → `google-webhook-{userId}` 채널 → `loadData(true)`
- Fallback: 5분 폴링 + 탭 포커스 시 `triggerRealtimeSync()` (`selectedGoogleIdsRef.length === 0`이면 자동 중단)

**이번 변경의 영향:**
- 웹훅 등록은 `DataContext.syncGoogleCalendar()`에서 처리 → 모달 플로우 변경과 **직접 무관**
- account 단계 추가 후 "구글 캘린더 선택" → `loadCalendars()` → `onSyncComplete()` → `syncGoogleCalendar()` 순서 유지됨 → 웹훅 등록 타이밍 동일

**잔존 리스크 및 점검 항목:**
- `handleGoogleDisconnect()` → `deleteAllGoogleData()`가 **`google_watch_channels` 테이블도 정리하는지 확인** 필요. 정리하지 않으면 해제 후에도 웹훅 신호가 수신되어 불필요한 `loadData(true)` 호출 발생 (데이터 오류는 아니지만 낭비)
- 해제 후 `google-webhook-{userId}` Broadcast 채널 구독이 남아있으면, 만료 전 채널에서 `sync-complete` 신호 수신 시 `lastSyncTimesRef`를 이미 해제된 calendarId로 갱신할 수 있음. `googleSyncTokens` localStorage는 `handleGoogleDisconnect`에서 정리되므로 다음 재연동 시 전체 fetch로 복구됨

**결론:** 웹훅 플로우 자체 변경 없음. `deleteAllGoogleData()` 구현에서 `google_watch_channels` 정리 여부만 사전 확인.

---

### ② Outbound Sync 아이콘 상태 (Riff → iCloud/Google)

**현재 구조:**
- 섹션 헤더 아이콘: `isCalDAVCloudOff = groups.riffFromIcloud.length === 0 || isCalDAVAuthError`
- 캘린더 아이템 아이콘: `cal.createdFromApp && cal.caldavSyncUrl` 있으면 `/images/iCloud.png` 표시, `isCalDAVAuthError`면 `/images/iCloud_alert.png`
- `isCalDAVAuthError`는 `localStorage.getItem('caldavAuthError')` 값 기반 (MainLayout에서 읽음)

**이번 변경의 영향 (핵심 리스크):**
- 기존: `handleDisconnect()` → `window.location.reload()` → 모든 상태 초기화
- 변경 후: `handleSwitchDisconnect()` → `loadData(true)` → React 상태만 갱신
- **`caldavAuthError` localStorage 잔존 문제**: `loadData(true)`만 호출하면 `isCalDAVAuthError`가 여전히 `true`로 남아 `cloud_off` 아이콘이 유지됨. 해제 시 `localStorage.removeItem('caldavAuthError')` 명시적 제거 필수
- **`caldavCalendarMetadata` 잔존 문제**: `deleteAllCalDAVData()`가 DB에서 CalDAV 레코드를 삭제해도, `caldavCalendarMetadata` localStorage가 남으면 다음 `loadData`에서 섹션이 즉시 비워지지 않을 수 있음. 해제 시 해당 키도 정리 필요
- Outbound 아이콘(`/images/iCloud.png`): 해제된 Riff-origin 캘린더는 `convertXxxToLocal()`로 처리되어 `caldavSyncUrl = null`이 됨. `loadData(true)` 후 메타데이터 갱신으로 자동 제거 → 문제없음

**점검 항목:**
- `handleSwitchDisconnect()` 내에서 `localStorage.removeItem('caldavAuthError')` 호출 확인
- `deleteAllCalDAVData()` 완료 후 `caldavCalendarMetadata` localStorage 정리 여부 확인
- `loadData(true)` 후 사이드바 `groups.riffFromIcloud`가 즉시 빈 배열로 반영되는지 수동 확인

---

### ③ 로컬 저장소 & 암호화 캐시

**현재 구조:**
- 캐시 키: `calendarCache:v1:{userId}:core` (AES 암호화, 5분 TTL)
- `loadData` 첫 호출 시에만 캐시로 hydrate (`hasHydratedFromCacheRef` 단회 처리)
- `force=true` 시 throttle(1500ms) 무시하고 네트워크 fetch → 완료 후 캐시 덮어쓰기
- `excludeCalendarUrls` 파라미터: 해제된 캘린더 URL을 전달하면 merge 시 해당 이벤트 제외

**이번 변경의 영향:**
- `loadData(true)` 호출로 5분 TTL 캐시 무시하고 즉시 fetch → 해제된 CalDAV 이벤트는 서버에서 이미 삭제됐으므로 fetch 결과에 포함 안 됨 → 캐시 새로 쓰기 → 문제없음
- **`excludeCalendarUrls` 전달 권장**: `handleCalDAVDisconnectSuccess`에서 `loadData(true, 해제된CalDAV URL목록)` 호출 시 merge 단계에서 즉시 이벤트 제거 가능. 전달하지 않아도 네트워크 fetch 완료 후 결과적으로 제거되나, 전달하면 응답 대기 중 stale 이벤트 노출 방지
- `hasHydratedFromCacheRef`: 이미 `true`이면 다시 캐시로 hydrate하지 않음 → 해제 후 stale 캐시가 재적용되지 않음 → 안전

**점검 항목:**
- `handleCalDAVDisconnectSuccess`에서 `loadData(true, 해제URL목록)` 호출 시 URL 목록 수집 방법 확인 (DataContext 또는 CalDAVSyncModal에서 접근 가능한 CalDAV 캘린더 URL 목록)
- `deleteAllGoogleData()` 후 `googleCalendarsMeta`, `googleSelectedCalendarIds`, `googleSyncTokens`, `googleLastSyncTimes` localStorage 정리 → 기존 `handleGoogleDisconnect`에서 이미 처리됨 (유지)
- CalDAV 해제 시 `caldavCalendarMetadata`, `caldavAuthError`, `caldavSyncTokens:*` 정리 → `handleSwitchDisconnect`에서 명시적으로 처리

---

### ④ Native 앱 ↔ 웹 실시간 동기화

**현재 구조:**
- Realtime 구독 테이블: `emotion_entries`, `routine_completions`, `todos`, `diary_entries`, `routines`
- **`events` 테이블은 구독에서 의도적으로 제외** — Google/CalDAV 동기화 시 upsert loop 방지
- Google 웹훅은 별도 Broadcast 채널(`google-webhook-{userId}`)로 분리 처리
- 폴링: 5분 주기 + 탭 포커스. `selectedGoogleIdsRef.length === 0`이면 자동 중단

**이번 변경의 영향:**
- 모달 플로우 변경(account 단계 추가)은 Realtime 채널 구독/해제와 무관
- Google 해제 후 Broadcast 채널(`google-webhook-{userId}`)은 DataContext의 `useEffect` cleanup에서 `webhookChannel.unsubscribe()`를 호출하는지 확인 필요. 호출하지 않으면 이미 해제된 calendarId로 `sync-complete` 수신 시 `loadData(true)` 재호출 가능 (큰 문제는 아니나 낭비)
- `selectedGoogleIdsRef.current`는 `googleSelectedCalendarIds` localStorage 기반. 해제 시 `handleGoogleDisconnect`에서 `localStorage.removeItem('googleSelectedCalendarIds')` 호출 → 다음 폴링 트리거에서 `selectedGoogleIdsRef.length === 0` → 자동 중단 → 안전

**점검 항목:**
- DataContext의 webhookChannel useEffect cleanup이 `unsubscribe()`를 호출하는지 확인. 호출하지 않으면, 해제 후 재연동 시 채널이 중복 등록될 수 있음
- 스위치 OFF → `onDisconnect()` 즉시 실행(confirm 없음) → Native 앱이 동일 시점에 동기화 중이면 race condition 발생 가능. 단, Supabase RLS가 user_id 기준으로 격리하므로 데이터 오염은 없음

---

## 변경 대상 파일

| 파일 | 변경 내용 |
|------|-----------|
| [src/components/CalDAVSyncModal.tsx](src/components/CalDAVSyncModal.tsx) | 자동 스킵 제거, 스위치 추가, 버튼/제목 변경, disconnect 토스트화, `caldavAuthError` 정리 추가 |
| [src/components/CalDAVSyncModal.module.css](src/components/CalDAVSyncModal.module.css) | 스위치 행 스타일 |
| [src/components/GoogleSyncModal.tsx](src/components/GoogleSyncModal.tsx) | account 단계 추가, 자동 fetch 제거, 스위치, 제목/버튼 변경 |
| [src/components/GoogleSyncModal.module.css](src/components/GoogleSyncModal.module.css) | account 단계 스타일 |
| [src/components/MainLayout.tsx](src/components/MainLayout.tsx) | CalDAV 해제 콜백 구현(`excludeCalendarUrls` 검토), Google disconnect confirm 제거 |
| [src/components/AppModals.tsx](src/components/AppModals.tsx) | 새 props 연결 |

**사전 확인 필요 (변경 전):**
- `src/services/api.ts`: `deleteAllGoogleData()`가 `google_watch_channels` 테이블도 삭제하는지
- `src/contexts/DataContext.tsx`: webhookChannel useEffect cleanup에서 `unsubscribe()` 호출 여부

---

## 검증 시나리오

### 기본 플로우
1. **iCloud 연결됨** → cloud_sync → 계정연결(스위치 ON) → iCloud 캘린더 연결 → 캘린더 선택 → 동기화
2. **iCloud 연결됨** → cloud_sync → 스위치 OFF → 해제 토스트 → 모달 닫힘 → cloud_off 아이콘 즉시 반영
3. **iCloud 연결 끊김** → cloud_off → 계정연결(스위치 OFF·비활성) → 정보 입력 → iCloud 캘린더 연결 → 캘린더 선택 → 동기화
4. **Google 연결됨** → cloud_sync → 계정연결(이메일·스위치 ON) → 구글 캘린더 선택 → 캘린더 선택 → 동기화
5. **Google 연결됨** → cloud_sync → 스위치 OFF → 해제 토스트 → 모달 닫힘
6. **Google 연결 끊김** → cloud_off → 계정연결(스위치 OFF·비활성, OAuth 버튼) → OAuth 완료 → 캘린더 선택
7. **reconnect 경로** → 컨텍스트 메뉴 → auth-only 모드 → 계정연결 단계 정상 진입

### 4가지 우려사항 검증
8. **[웹훅]** Google 해제 후 5분 내 외부 캘린더 변경 → 웹훅 수신 없음 또는 수신해도 UI 오류 없음
9. **[아이콘]** CalDAV 해제 직후(reload 없이) → 사이드바 cloud_off 아이콘, iCloud.png 제거 즉시 반영
10. **[캐시]** CalDAV 해제 후 → 해제된 CalDAV 이벤트가 캘린더 뷰에서 즉시 사라짐 (stale 캐시 미노출)
11. **[Native]** Google 해제 후 → Native 앱에서 변경 발생해도 웹 UI에 에러 없음, 폴링 자동 중단 확인
