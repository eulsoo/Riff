# Riff 배포 가이드

Vercel 배포 및 OWASP Top 10 기준 배포 시점 보안 적용 사항을 정리합니다.

---

## 1. Vercel 배포 후 Supabase 설정

Google/Kakao 로그인이 Vercel URL로 리다이렉트되려면 Supabase URL 설정이 필요합니다.

### Supabase 대시보드

1. [Supabase](https://supabase.com) → Riff-dev 프로젝트
2. **Authentication** → **URL Configuration**
3. 다음 설정:

| 설정 | 값 |
|------|-----|
| **Site URL** | Production URL (예: `https://riff.vercel.app`) |
| **Redirect URLs** | `http://localhost:3000/**` (로컬)<br>`https://*.vercel.app/**` (Vercel Preview/Production) |

---

## 2. 환경 변수 (Vercel)

Vercel 프로젝트 설정 → Environment Variables:

| 변수 | 적용 환경 | 비고 |
|------|-----------|------|
| `VITE_SUPABASE_URL` | Production, Preview | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | Production, Preview | anon public key (클라이언트용) |

⚠️ **주의**: `SUPABASE_SERVICE_ROLE_KEY`는 클라이언트에 노출되지 않도록 Edge Functions 환경에서만 사용합니다.

---

## 3. OWASP Top 10 배포 시점 보안 체크리스트

### A01: Broken Access Control

| 항목 | 적용 | 비고 |
|------|------|------|
| RLS(Row Level Security) 활성화 | ✅ | `events`, `routines`, `todos`, `diary_entries`, `user_tokens`, `calendar_metadata`, `caldav_sync_settings` 등 |
| 서버 측 권한 검증 | ✅ | Supabase RLS + Edge Functions |
| IDOR 방지 | ✅ | RLS 정책으로 사용자별 데이터 격리 |

### A02: Cryptographic Failures

| 항목 | 적용 | 비고 |
|------|------|------|
| HTTPS 강제 | ✅ | Vercel 기본 적용 |
| HSTS | ✅ | `.vercel.app` 도메인에 Vercel 자동 적용 |
| 비밀/키 환경 변수 관리 | ✅ | `.env` 미커밋, Vercel 환경 변수 사용 |
| CalDAV 비밀번호 암호화 | ✅ | Edge Function에서 `SUPABASE_SERVICE_ROLE_KEY`로 암호화 저장 |

### A03: Injection

| 항목 | 적용 | 비고 |
|------|------|------|
| Content-Security-Policy | ✅ | `vercel.json` 헤더로 설정, `script-src 'self'` (unsafe-inline 제거) |
| 파라미터화된 쿼리 | ✅ | Supabase 클라이언트 사용 |
| 사용자 입력 검증 | ✅ | 클라이언트 + RLS |

### A04: Insecure Design

| 항목 | 적용 | 비고 |
|------|------|------|
| Rate limiting | ⏳ | Supabase/Vercel 기본 제공 활용, 민감 API는 추후 강화 검토 |
| Defense in depth | ✅ | RLS + Edge Functions + 클라이언트 검증 |

### A05: Security Misconfiguration

| 항목 | 적용 | 비고 |
|------|------|------|
| X-Content-Type-Options: nosniff | ✅ | `vercel.json` |
| X-Frame-Options: DENY | ✅ | `vercel.json` (클릭재킹 방지) |
| Referrer-Policy | ✅ | `strict-origin-when-cross-origin` |
| 디버그 비활성화 | ✅ | 프로덕션 빌드 기본 |

### A06: Vulnerable and Outdated Components

| 항목 | 적용 | 비고 |
|------|------|------|
| 의존성 CVE 모니터링 | ⏳ | `npm audit`, xmldom override 등 적용 |
| 사용하지 않는 의존성 제거 | ✅ | 정기 점검 |

### A07: Identification and Authentication Failures

| 항목 | 적용 | 비고 |
|------|------|------|
| Supabase Auth | ✅ | OAuth (Google, Kakao), PKCE |
| Redirect URL 화이트리스트 | ✅ | Supabase Redirect URLs 설정 |
| 세션 관리 | ✅ | `persistSession`, `autoRefreshToken` |

### A08: Software and Data Integrity Failures

| 항목 | 적용 | 비고 |
|------|------|------|
| 의존성 출처 | ✅ | npm 공식 레지스트리 |
| Subresource Integrity | ⏳ | 외부 스크립트 사용 시 SRI 검토 |

### A09: Security Logging and Monitoring

| 항목 | 적용 | 비고 |
|------|------|------|
| Supabase 로그 | ✅ | 대시보드에서 확인 |
| Vercel 배포/런타임 로그 | ✅ | Deployments, Logs 탭 |

### A10: Server-Side Request Forgery (SSRF)

| 항목 | 적용 | 비고 |
|------|------|------|
| CalDAV 프록시 URL 검증 | ✅ | `caldav-proxy` Edge Function에서 허용 도메인 제한 |

---

## 4. vercel.json 보안 헤더

현재 적용된 헤더:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy`: script-src 'self' (unsafe-inline 제외)

---

## 5. 배포 후 확인 사항

1. **Production URL**에서 Google/Kakao 로그인 → Vercel 도메인으로 리다이렉트되는지 확인
2. **브라우저 개발자 도구** → Network 탭에서 보안 헤더 확인
3. **Supabase** → Authentication → Users: 로그인 사용자 생성 확인
