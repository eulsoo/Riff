# 인수인계 기록 (Vividly)

## 목적
본 문서는 지금까지 진행된 작업을 정리하고, 특히 **오늘 진행한 CalDAV 401 문제**의 원인 분석 과정과 실패 원인, 현재 상태를 명확히 기록하기 위한 인수인계 문서입니다.

---

## 1) 전체 작업 요약 (핵심 흐름)
- **투두 자동 이월**: 미완료 투두가 주간 종료 시 이번 주로 자동 이월되도록 수정.
- **레이아웃 이슈**: `todoListHeader`의 너비 축소 문제는 `flex-shrink` 원인으로 판단 및 수정.
- **스크롤/오늘 위치**: 새로고침 시 현재 주가 중앙에 위치하도록 스크롤 복원 로직 보강.
- **루틴 UI/일기 기능 확장**:  
  - 모든 날짜에 `dayRoutine` 박스 표시  
  - 루틴 아이콘 24x24, 텍스트 제거  
  - 일기쓰기 루틴(NotebookPen) 추가  
  - 호버 시 빈 영역에 나타나고 완료 시 유지  
  - 미래 날짜에도 일기쓰기 아이콘 표시
- **일기 모달**: 전체 화면, 제목/본문만, 자동저장(0.5s).  
  저장 상태 표시 루프 문제 해결, 체크 표시 DB 연동.
- **일기 콘텐츠 편집**: contentEditable 기반으로 `<p>` 자동 분리, `Shift+Enter` 줄바꿈 지원, `<p>` 클래스 부여 및 CSS로 마진 제어.
- **일기 모달 UI 강화**:  
  - 좌측 고정 200px 사이드바(일자/이벤트 표시)  
  - 우하단 삭제 아이콘  
  - 새로고침 시 모달 유지(해시 기반)
- **성능 개선**:  
  - 캐시 + SWR 적용 (localStorage hydrate)  
  - idle fetch 적용  
  - 디바운스/인플라이트 가드  
  - DB 인덱스 추가  
  - 범위 제한 로딩 및 프리패치
- **CalDAV 증분 동기화**: sync-token 기반 증분 동기화 구현.
- **멀티 유저 전환**: 주요 테이블 RLS(데이터 격리) 적용 및 기존 데이터 소유권 이전 완료.

---

## 2) CalDAV 401 문제: 오늘 작업 요약

### 문제 현상
- `caldav-proxy` 호출 시 **401 (Unauthorized)** 발생.
- 콘솔 에러 바디: `{"code":401,"message":"Invalid JWT"}`.

### 확인된 사실
- 클라이언트 토큰은 **정상** (Auth 서버 `/auth/v1/user`로 검증 시 통과).
- **Verify JWT = ON** 일 때만 `Invalid JWT`.
- **Verify JWT = OFF**일 때는 동기화 정상 동작.

### 시도한 조치(실패 흐름)
1. **클라이언트 헤더 보강**
   - `Authorization` + `apikey` 명시 전달.
   - 결과: 여전히 `Invalid JWT`.

2. **에러 바디 출력 추가**
   - 원인 확인을 위해 응답 바디 로깅.
   - 확인 결과: `Invalid JWT` 확정.

3. **Verify JWT OFF + 내부 검증 구현**
   - Edge Function에서 `Authorization`을 받아 `/auth/v1/user`로 검증하도록 코드 추가.
   - 목적: 게이트웨이 검증을 우회하고 내부 검증으로 보안 유지.
   - 결과: **OFF일 때 정상 동작** 확인됨.

4. **Verify JWT ON 복귀**
   - ON 상태로 전환 시 즉시 `Invalid JWT` 재발.

### 왜 실패했는가 (핵심 원인)
- **게이트웨이 JWT 검증이 Auth 검증과 불일치**  
  - `Invalid JWT`는 **게이트웨이 레벨 서명 검증 실패**를 의미.
  - 그러나 동일 토큰이 `/auth/v1/user`에서 통과함 → **Auth 서버는 유효하다고 판단**.
  - 즉, **게이트웨이 측 JWT Secret/키 상태가 Auth와 불일치**한 것으로 추정.

---

## 3) 오늘 진행한 변경 사항 (파일 기준)

### `src/services/caldav.ts`
- **401 응답 바디 로깅 추가**  
  목적: `Invalid JWT` 원인 확인을 위한 응답 바디 출력.

### `supabase/functions/caldav-proxy/index.ts`
- **Verify JWT OFF일 때 내부 JWT 검증 추가**
  - `Authorization` 헤더 확인
  - `/auth/v1/user` 호출로 토큰 유효성 검사
  - 실패 시 401 반환

> 참고: Edge Function 배포는 **MCP 배포가 내부 오류로 실패**하여,  
> **대시보드 수동 배포**로 진행됨.

---

## 4) 현재 상태 (가장 중요)

### ✅ 정상 동작하는 조합
- **Verify JWT = OFF**
- Edge Function 내부에서 `/auth/v1/user` 검증 수행
- 동기화 정상 완료 로그 확인

### ❌ 문제가 발생하는 조합
- **Verify JWT = ON**
- 즉시 `Invalid JWT` 발생 → 동기화 실패

즉, **현재는 게이트웨이 검증과 Auth 검증의 불일치 상태**로 볼 수 있습니다.

---

## 5) 다음 단계 옵션

### 옵션 A (현실적 운영 유지)
- **Verify JWT OFF 유지**
- **내부 `/auth/v1/user` 검증 유지**
- 보안은 유지되며, 요청 1회 추가 비용만 발생
- 즉시 운영 안정화 가능

### 옵션 B (근본 해결 시도)
- **JWT Secret Rotate** 수행
- 모든 클라이언트 재로그인 필요
- 운영 중이면 리스크 큼
- 성공 시 Verify JWT ON 복귀 가능

---

## 6) 인수인계용 핵심 메시지
- 현재 `Invalid JWT`는 **게이트웨이 검증 문제**이며, **토큰 자체는 유효**함.
- **Verify JWT OFF + 내부 검증**은 안전한 우회책이며 정상 동작.
- **JWT Secret 회전은 영향 범위가 커서 신중히 결정**해야 함.

---

## 7) 보안 관련 결정 사항 (중요)
- **결정**: `caldav-proxy` Edge Function의 `Enforce JWT Verification` 옵션을 **OFF**로 설정함.
- **이유**: JWT Secret 불일치로 인해 유효한 토큰도 게이트웨이에서 401로 차단되는 문제 발생.
- **보안 조치**: 게이트웨이 검증을 끄는 대신, **코드 레벨(`caldav-proxy/index.ts`)에서 `supabase.auth.getUser()`를 사용하여 토큰 유효성을 직접 검증**하고 있음.
- **안전성**: 유효하지 않은 토큰 접근 시 여전히 차단되므로 **보안상 안전함**.
- **향후 계획**: 추후 서비스 점검 시 `JWT Secret Rotate`를 수행하여 키를 재설정하면 다시 ON으로 변경 가능 (단, 모든 사용자 로그아웃 발생).

## 인수인계 문서 (Handoff Documentation)
### 📅 현재 세션: 최적화 및 보안 (Optimization & Security)
#### 1. CalDAV 동기화 수정
문제: 캘린더 동기화 시 401 Unauthorized (Invalid JWT) 에러 발생.
원인: Supabase Gateway의 "Verify JWT" 설정이 클라이언트 토큰과 충돌.
해결책:
- Supabase 대시보드에서 caldav-proxy 엣지 함수의 "Verify JWT" 설정 비활성화.
- 보안 유지를 위해 함수 코드 내(supabaseWrapper.ts)에서 수동 JWT 검증 로직 구현.
상태: ✅ 수정 및 검증 완료.

#### 2. 네트워크 비용 최적화 (윈도잉 적용)
문제: 
앱 시작 시 전체 이벤트 히스토리(수천 개의 행)를 모두 로드하여(`fetchEvents`), 높은 네트워크 사용량과 느린 로딩 속도 발생.
해결책: 윈도잉(Windowing) 구현.
초기 로드: 현재 보이는 범위만 로드 (과거 8주 ~ 미래 12주 + 버퍼).
무한 스크롤: 사용자가 스크롤할 때 과거 또는 미래 이벤트를 청크 단위로 동적으로 로드.
효과: 초기 페이로드 크기 획기적 감소.
상태: ✅ 구현 및 검증 완료.

#### 3. 보안 강화 (LocalStorage 암호화)
문제: 민감한 데이터(일기, 이벤트, 세션 토큰)가 localStorage에 평문(JSON)으로 저장되어 XSS 공격 및 물리적 열람에 취약함.
해결책: AES 암호화 적용.
localStorage에 데이터를 쓸 때(`writeCache`) crypto-js를 사용하여 암호화.
데이터를 읽을 때(`readCache`) 즉시 복호화.
참고: 현재 클라이언트 사이드 아키텍처(Vite SPA) 제약으로 인해 HttpOnly 쿠키 대신 선택.
상태: ✅ 구현 및 검증 완료.

#### 4. 멀티 유저 지원 (RLS 구현)
문제: 앱이 단일 사용자 전용으로 설계되어 보안 정책이 공개 접근(Public Access)으로 설정됨. 신규 가입 시 기존 데이터가 노출될 위험 있었음.
해결책: 
- Supabase에서 "Allow new users to sign up" 설정 확인.
- 모든 주요 테이블(`events`, `routines`, `todos` 등)에 `user_id` 컬럼 추가.
- 기존 데이터를 관리자(admin) 사용자로 백필(Backfill) 완료.
- RLS 정책 강화: "Public Access"에서 "Users can only see their own data(내 데이터만 보기)"로 변경.
상태: ✅ 구현 및 검증 완료.

#### 5. 카카오 소셜 로그인 (Kakao Login)
문제: 한국 사용자 접근성을 위해 카카오 로그인 지원이 필수적임.
해결책:
- **로그인 구현**: Supabase Auth와 Kakao OAuth 연동.
- **`KOE205` 에러 해결 (중요)**:
  - 원인: 카카오 비즈니스 앱 인증 미완료로 인해 `account_email` 권한 획득 실패.
  - 해결: `scope: 'profile_nickname,profile_image'`를 명시적으로 지정하여 이메일 요청 제외.
- **`KOE006` 에러 해결 (중요)**:
  - 원인: Redirect URI 불일치.
  - 해결: 카카오 디벨로퍼스 설정에서 URI 입력 후 **반드시 `+` 버튼을 눌러 등록**해야 함을 확인.
- **Client Secret**: 카카오 보안 설정에 따라 Supabase Provider 설정에 Client Secret 필수 입력.
상태: ✅ 구현 및 검증 완료 (이메일 없이 닉네임/프로필 사진만으로 로그인 가능).

#### 6. 사용자 편의성 (최근 로그인 기억하기)
문제: 사용자가 구글/카카오 중 어떤 걸로 가입했는지 잊어버려 혼란 발생.
해결책: `localStorage` 활용.
- 로그인 성공 시 `last_login_provider`에 'google' 또는 'kakao' 저장.
- 재방문 시 해당 버튼 위에 "최근 사용" 빨간색 배지(Badge) 표시.
- 재방문 시 해당 버튼 위에 "최근 사용" 빨간색 배지(Badge) 표시.
상태: ✅ 구현 및 검증 완료.

#### 7. CalDAV 동기화 고도화 (색상 및 이름)
문제:
- 애플 캘린더 등 외부 캘린더 연동 시, 원래 색상(#FF9500 등)이 아닌 기본 파란색으로만 표시됨.
- 캘린더 이름이 `Unknown`으로 뜨는 경우가 발생 (URL 끝의 슬래시 처리 문제).
해결책:
- **색상 동기화**: `fetchCalendarEvents` 및 `fetchCalendars` (목록 조회) 시 `PROPFIND` 요청에 `<apple:calendar-color>`와 `<cal:calendar-color>` 태그 추가.
- **8자리 HEX 처리**: `#FF9500FF`와 같은 8자리 색상 코드를 6자리로 자르고 불투명도 처리를 하여 UI에 정상 표시되도록 수정.
- **캘린더 이름 개선**: `displayname`이 없는 경우 URL의 마지막 부분을 이름으로 사용하되, 끝부분의 슬래시(`/`)를 제거하는 정제 로직 추가.
- **동기화 초기화**: `연동 해제 및 데이터 삭제` 버튼을 추가하여 꼬인 데이터를 완전히 초기화하고 다시 받을 수 있도록 기능 제공.
상태: ✅ 구현 및 검증 완료 (색상, 이름 정상 표시).

📝 대기 중 / 다음 단계 (Pending / Next Steps)
즉각적인 추가 작업 없음. 배포 준비 완료.
본 `HANDOFF.md` 파일은 이러한 아키텍처 결정을 추적하는 중앙 문서로 활용됩니다.