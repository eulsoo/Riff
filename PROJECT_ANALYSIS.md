# ES-Calendar 프로젝트 분석 문서

## 📋 프로젝트 개요

**ES-Calendar**는 주간 기반의 일정 관리 웹 애플리케이션입니다. 이벤트, 루틴, 투두 리스트를 통합하여 관리할 수 있는 캘린더 앱입니다.

- **프로젝트명**: Weekly Calendar UI
- **버전**: 0.1.0
- **기술 스택**: React 18 + TypeScript + Vite
- **백엔드**: Supabase (인증 + 데이터베이스)
- **UI 프레임워크**: Radix UI + Tailwind CSS

## 🏗️ 기술 스택 상세

### 프론트엔드
- **React 18.3.1**: UI 라이브러리
- **TypeScript**: 타입 안정성
- **Vite 6.3.5**: 빌드 도구 및 개발 서버
- **Tailwind CSS**: 스타일링
- **Radix UI**: 접근성 있는 UI 컴포넌트 라이브러리
- **Lucide React**: 아이콘 라이브러리

### 백엔드 & 인증
- **Supabase**: 
  - Google OAuth 인증
  - PostgreSQL 데이터베이스
  - Row Level Security (RLS) 활성화

## 📁 프로젝트 구조

```
es-calendar/
├── src/
│   ├── App.tsx                 # 메인 애플리케이션 컴포넌트
│   ├── main.tsx                # React 진입점
│   ├── components/
│   │   ├── WeekCard.tsx        # 주간 카드 컴포넌트
│   │   ├── EventModal.tsx      # 이벤트 추가 모달
│   │   ├── EventDetailModal.tsx # 이벤트 상세/수정 모달
│   │   ├── RoutineModal.tsx    # 루틴 관리 모달
│   │   ├── RoutineIcon.tsx     # 루틴 아이콘 컴포넌트
│   │   ├── TodoList.tsx        # 투두 리스트 컴포넌트
│   │   ├── Login.tsx           # 로그인 컴포넌트
│   │   └── ui/                 # Radix UI 컴포넌트들
│   ├── lib/
│   │   └── supabase.ts         # Supabase 클라이언트 설정
│   ├── services/
│   │   └── api.ts              # API 호출 함수들
│   └── styles/
│       └── globals.css         # 전역 스타일
├── supabase_schema.sql         # 데이터베이스 스키마
├── enable_auth.sql             # 인증 설정 SQL
└── package.json                # 의존성 관리

```

## 🗄️ 데이터베이스 스키마

### 1. Events (이벤트)
- `id`: UUID (Primary Key)
- `date`: TEXT (YYYY-MM-DD 형식)
- `title`: TEXT (필수)
- `memo`: TEXT (선택)
- `start_time`: TEXT (선택)
- `end_time`: TEXT (선택)
- `color`: TEXT (필수)
- `created_at`: TIMESTAMPTZ

### 2. Routines (루틴)
- `id`: UUID (Primary Key)
- `name`: TEXT (필수)
- `icon`: TEXT (필수)
- `color`: TEXT (필수)
- `days`: INTEGER[] (필수, 0=월 ~ 6=일)
- `created_at`: TIMESTAMPTZ

### 3. Routine Completions (루틴 완료 기록)
- `id`: UUID (Primary Key)
- `routine_id`: UUID (Foreign Key → routines.id)
- `date`: TEXT (YYYY-MM-DD 형식)
- `completed`: BOOLEAN (기본값: false)
- `created_at`: TIMESTAMPTZ
- Unique constraint: (routine_id, date)

### 4. Todos (투두 리스트)
- `id`: UUID (Primary Key)
- `week_start`: TEXT (YYYY-MM-DD 형식, 주의 시작 날짜)
- `text`: TEXT (필수)
- `completed`: BOOLEAN (기본값: false)
- `created_at`: TIMESTAMPTZ

**참고**: 모든 테이블에 RLS(Row Level Security)가 활성화되어 있으며, 현재는 공개 접근 정책이 설정되어 있습니다.

## 🎯 주요 기능

### 1. 이벤트 관리
- ✅ 날짜별 이벤트 추가/수정/삭제
- ✅ 제목, 메모, 시작/종료 시간 설정
- ✅ 색상 라벨로 분류
- ✅ 이벤트 클릭 시 상세 모달 표시

### 2. 루틴 관리
- ✅ 요일별 반복 루틴 생성
- ✅ 아이콘 및 색상 커스터마이징
- ✅ 루틴 완료 체크 (날짜별)
- ✅ 루틴 삭제

### 3. 투두 리스트
- ✅ 주 단위 투두 리스트 관리
- ✅ 투두 추가/수정/삭제
- ✅ 완료 체크
- ✅ 인라인 편집 기능

### 4. 주간 뷰
- ✅ 무한 스크롤로 과거/미래 주간 로드
- ✅ 현재 주 하이라이트
- ✅ 오늘 날짜 표시
- ✅ 주말 구분 (회색 배경)
- ✅ 연도 표시 (Intersection Observer 사용)

## 🔐 인증 시스템

- **인증 방식**: Google OAuth (Supabase Auth)
- **세션 관리**: Supabase 세션 기반
- **로그인 없이 접근 불가**: 세션이 없으면 Login 컴포넌트 표시

## 🚀 실행 방법

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경 변수 설정
`.env` 파일을 생성하고 다음 내용을 추가:
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. 개발 서버 실행
```bash
npm run dev
```

서버는 `http://localhost:3000`에서 실행됩니다.

### 4. 빌드
```bash
npm run build
```

## 📝 주요 컴포넌트 설명

### App.tsx
- 메인 애플리케이션 로직
- 상태 관리 (events, routines, todos, routineCompletions)
- 무한 스크롤 구현
- 데이터 로딩 및 CRUD 작업 처리

### WeekCard.tsx
- 주간 카드 UI 렌더링
- 7일 그리드 레이아웃
- 이벤트, 루틴, 투두 표시
- 날짜 클릭 이벤트 처리

### EventModal.tsx
- 새 이벤트 추가 모달
- 폼 입력 (제목, 메모, 시간, 색상)

### EventDetailModal.tsx
- 기존 이벤트 상세 보기/수정/삭제

### RoutineModal.tsx
- 루틴 관리 모달
- 루틴 추가/삭제
- 아이콘 및 색상 선택

### TodoList.tsx
- 주 단위 투두 리스트
- 인라인 편집 기능

## 🔄 데이터 흐름

1. **로그인** → Supabase 세션 생성
2. **세션 확인** → 데이터 로드 (events, routines, todos, completions)
3. **사용자 액션** → API 호출 (`services/api.ts`)
4. **Supabase 업데이트** → 상태 업데이트 → UI 리렌더링

## ⚠️ 현재 상태 및 개선 가능한 부분

### 보안
- 현재 모든 테이블이 공개 접근 정책을 사용 중
- 사용자별 데이터 분리가 필요할 수 있음 (user_id 추가)

### 성능
- 무한 스크롤 구현됨 (과거 8주, 미래 8주씩 로드)
- 스크롤 위치 유지 로직 구현됨

### 기능
- 이벤트 드래그 앤 드롭 미구현
- 이벤트 반복 기능 미구현
- 알림/리마인더 기능 미구현

## 📚 참고 문서

- [Supabase 문서](https://supabase.com/docs)
- [Radix UI 문서](https://www.radix-ui.com/)
- [Tailwind CSS 문서](https://tailwindcss.com/docs)
- [React 문서](https://react.dev/)

## 🎨 UI/UX 특징

- 모던하고 깔끔한 디자인
- 반응형 레이아웃
- 부드러운 애니메이션 및 전환 효과
- 접근성 고려 (Radix UI 사용)
- 한국어 UI

## 🔧 개발 환경 설정

1. Node.js 설치 필요 (권장: v18 이상)
2. Supabase 프로젝트 생성 및 설정
3. 데이터베이스 스키마 적용 (`supabase_schema.sql`)
4. Google OAuth 설정 (Supabase Dashboard)
5. 환경 변수 설정

---

**마지막 업데이트**: 2024년
**프로젝트 상태**: 개발 중
