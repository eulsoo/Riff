# Google Calendar Sync 버그 수정

## 문제 요약

웹 Riff를 브라우저에 열어두면 매 60초마다 구글 캘린더 6개월치 전체 이벤트를 반복 fetch·upsert하면서 Supabase egress 6GB를 초과하고 DB가 read-only 상태로 전환되어 로그인이 불가능해지는 현상이 발생했다.

## 근본 원인

### 원인 1: `nextSyncToken`을 영원히 받지 못하는 구조

`fetchGoogleEvents`에서 항상 `singleEvents=true` + `orderBy=startTime` 파라미터를 전송했다.

Google Calendar API는 이 두 파라미터 조합이 있으면 `nextSyncToken`을 반환하지 않는다.

결과적으로 `syncToken`이 저장되지 않아 매 60초마다 전체 full sync가 반복되었다.

```
fetch 요청 (singleEvents=true + orderBy=startTime + timeMin + timeMax)
  → Google: nextSyncToken 반환 안 함
  → syncToken 저장 안 됨
  → 60초 후 또 full sync
  → 무한 반복
```

### 원인 2: 60초마다 수천 건 upsert → PostgreSQL Dead Tuple 폭증

Full sync = 6개월치 전체 이벤트 fetch → `bulkUpsertGoogleEvents`로 DB에 upsert.

PostgreSQL은 MVCC(Multi-Version Concurrency Control) 특성상 upsert 시 기존 row를 즉시 덮어쓰지 않고 새 버전의 row를 추가한 후 old row를 dead tuple로 남긴다.

```
60초마다 수천 건 upsert
  → dead tuple 누적
  → storage 폭증 (29MB DB → 500MB 한도 초과)
  → Supabase DB read-only 전환
  → 새 세션 저장 불가 → 로그인 실패
```

## 수정 내용

### 전략: `updatedMin` 기반 증분 동기화

`singleEvents=true` + `orderBy=startTime`은 유지하되,
최초 sync 이후에는 `updatedMin`(마지막 sync 시각)을 파라미터로 추가해 **변경된 이벤트만** fetch한다.

| 구분 | 변경 전 | 변경 후 |
|---|---|---|
| 초기 sync | timeMin + timeMax (전체) | timeMin + timeMax (전체, 동일) |
| 이후 sync | timeMin + timeMax (또 전체) | timeMin + timeMax + **updatedMin** (변경분만) |
| polling 주기 | 60초 | **5분** |
| 중복 방지 쿨다운 | 30초 | **60초** |

### 수정 파일

#### `src/lib/googleCalendar.ts`
- `fetchGoogleEvents` params에 `updatedMin?: string` 추가
- `updatedMin` 있으면 Google API 요청에 포함
- `loadGoogleLastSyncTimes` / `saveGoogleLastSyncTimes` 유틸 추가 (localStorage key: `googleLastSyncTimes`)

#### `src/contexts/DataContext.tsx`
- `lastSyncTimesRef` 추가 (calendarId → ISO timestamp)
- `syncGoogleCalendar`에서 `updatedMin: lastSyncTime` 전달
- sync 성공 후 현재 시각을 `lastSyncTimesRef`에 저장
- polling 주기: `60 * 1000` → `5 * 60 * 1000`
- 중복 방지: `30_000` → `60_000`
- 불필요해진 `syncToken` 기반 로직 제거

## 기대 효과

- 이후 sync 시 수천 건 → 수 건~수십 건으로 요청 대폭 감소
- Dead tuple 생성 최소화 → storage 안정화
- Egress 사용량 하루 300~400MB → 수 MB 수준으로 감소
