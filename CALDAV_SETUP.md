# CalDAV 동기화 설정 가이드

이 프로젝트는 Supabase Edge Functions를 사용하여 CalDAV 서버와의 CORS 문제를 해결합니다.

## 🚀 배포 방법

### 1. Supabase 프로젝트 연결

먼저 Supabase CLI로 프로젝트를 연결해야 합니다:

```bash
# Supabase에 로그인
supabase login

# 프로젝트 연결 (프로젝트 참조 ID 필요)
supabase link --project-ref your-project-ref
```

프로젝트 참조 ID는 Supabase 대시보드의 프로젝트 설정에서 확인할 수 있습니다.

### 2. Edge Function 배포

```bash
# CalDAV 프록시 Edge Function 배포
supabase functions deploy caldav-proxy
```

### 3. 로컬 테스트 (선택사항)

로컬에서 테스트하려면:

```bash
# Supabase 로컬 환경 시작
supabase start

# Edge Function 로컬 테스트
supabase functions serve caldav-proxy
```

## 📋 사용 방법

### iCloud CalDAV 설정

1. **앱 전용 비밀번호 생성**
   - [Apple ID 관리 페이지](https://appleid.apple.com) 접속
   - 로그인 → 보안 → 앱 전용 비밀번호 생성
   - 비밀번호 이름 입력 (예: "ES Calendar")
   - 생성된 비밀번호 복사

2. **캘린더 관리에서 동기화**
   - 웹 앱 우측 상단의 "CalDAV" 버튼 클릭
   - 서버 URL: `https://caldav.icloud.com`
   - 사용자명: Apple ID (예: `yourname@icloud.com`)
   - 비밀번호: 생성한 앱 전용 비밀번호
   - "캘린더 가져오기" 클릭
   - 동기화할 캘린더 선택
   - "동기화" 클릭

## 🔧 문제 해결

### Edge Function 배포 오류

```bash
# Supabase CLI 버전 확인
supabase --version

# 최신 버전으로 업데이트
brew upgrade supabase
```

### 인증 오류

- 앱 전용 비밀번호를 정확히 입력했는지 확인
- Apple ID에 2단계 인증이 활성화되어 있는지 확인
- 서버 URL이 정확한지 확인 (`https://caldav.icloud.com`)

### 캘린더를 찾을 수 없음

- iCloud에서 캘린더가 활성화되어 있는지 확인
- 캘린더가 공유되어 있거나 숨겨져 있지 않은지 확인

## 📝 참고사항

- Edge Function은 Supabase 프로젝트에 배포되어야 합니다
- 로컬 개발 환경에서는 `supabase functions serve`를 사용하여 테스트할 수 있습니다
- 프로덕션 환경에서는 반드시 Edge Function을 배포해야 합니다
