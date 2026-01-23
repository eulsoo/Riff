# 환경 변수 설정 가이드

## 1. .env 파일 생성

프로젝트 루트 디렉토리에 `.env` 파일을 생성하고 다음 내용을 추가하세요:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## 2. Supabase 프로젝트에서 정보 가져오기

1. [Supabase Dashboard](https://app.supabase.com)에 로그인
2. 프로젝트 선택 (또는 새 프로젝트 생성)
3. Settings > API 메뉴로 이동
4. 다음 정보를 복사:
   - **Project URL** → `VITE_SUPABASE_URL`에 입력
   - **anon/public key** → `VITE_SUPABASE_ANON_KEY`에 입력

## 3. 예시

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## 주의사항

- `.env` 파일은 절대 Git에 커밋하지 마세요 (이미 .gitignore에 추가됨)
- 프로덕션 환경에서는 환경 변수를 별도로 설정하세요
