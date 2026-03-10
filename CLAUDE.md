# Riff 프로젝트 — Claude 지침

## 프로젝트 개요

- **앱명**: Riff (주간 캘린더 UI)
- **스택**: React 19 + TypeScript + Vite + Supabase + Vercel
- **배포 현황**: 개발(dev) 배포 완료 / 프로덕션 미배포

## 기술 스택 요약

- **UI**: Radix UI 프리미티브 + CSS Modules
- **상태관리**: React Context (DataContext, SelectionContext, DragContext)
- **백엔드**: Supabase (PostgreSQL + RLS + Edge Functions)
- **외부 연동**: CalDAV(iCloud), Google Calendar, ICS 임포트
- **테스트**: Vitest
- **배포**: Vercel

## 주요 디렉토리

```
src/
├── components/   # UI 컴포넌트 (25개+)
├── contexts/     # 전역 상태 (Data, Selection, Drag)
├── hooks/        # 커스텀 훅
├── services/     # API 레이어, 동기화 플로우
├── lib/          # supabase, crypto, cache, eventLayout
├── utils/        # dateUtils
└── types.ts      # 공통 타입 정의

supabase/
├── functions/    # Edge Functions (caldav-proxy, refresh-google-token)
└── migrations/   # DB 마이그레이션
```

## 코드 품질 기준 (Martin Fowler 원칙)

### 자동 적용 (별도 지시 불필요)

- 미사용 변수, 함수, import 발견 시 제거
- `as any` 타입 캐스팅 → 적절한 타입으로 교체
- **200줄 이상** 함수/컴포넌트 → 분리 검토
- **50줄 이상** 독립 로직 블록 → 함수/훅 추출 검토
- 중복 주석 제거, 불필요한 빈 줄 정리

### 먼저 상의할 것

- 파일 구조 전면 개편 (폴더 이동, 파일 분할)
- 성능에 영향을 줄 수 있는 변경
- 외부 API 인터페이스 변경
- 트레이드오프가 있는 결정 (A vs B)

### Code Smell 임계값

| Smell | 기준 | 대응 |
|-------|------|------|
| Long Function | 200줄 이상 | 분리 검토 |
| Long Parameter List | 5개 이상 | 객체로 묶기 |
| Duplicated Code | 3회 이상 | 추출 (Rule of Three) |

## 보안 원칙

- Supabase RLS는 모든 테이블에 유지
- `SUPABASE_SERVICE_ROLE_KEY`는 Edge Function에서만 사용, 클라이언트 노출 금지
- `.env` 파일 절대 커밋 금지
- CSP, X-Frame-Options 등 `vercel.json` 보안 헤더 유지

## 협업 방식

- 사용자가 직접 파일을 수정한 경우 별도 알림 없이 다음 요청 시 파일을 읽어 최신 상태 반영
- 같은 파일을 동시에 수정하는 상황은 피하기
- 파일 구조 변경, 성능 영향, 트레이드오프가 있는 결정은 먼저 상의 후 진행
