# 감정 시스템 개편 계획 (Emoji 문자 -> PNG 이미지)

## 1. 개요
현재 텍스트(이모지 문자)로 저장되고 표시되는 감정 시스템을 세트 기반의 PNG 이미지 방식으로 개편합니다.
추후 감정의 종류와 세트 수가 자유롭게 확장될 수 있는 유연한 구조로 설계합니다.

## 2. 요구사항
- **포맷 변경**: 이모지(텍스트) ➡️ PNG 이미지
- **감정 종류 (5가지)**: `good`, `curious`, `normal`, `sad`, `angry`
- **세트 구성**: 시작은 2개 세트로 구성 (첫 번째 줄 Set 1, 두 번째 줄 Set 2)
- **에셋 확장성**: 향후 감정 종류 및 세트 수가 늘어날 수 있도록 변수화 혹은 배열 구조화
- **서버 로딩**: 이미지들은 서버 환경(`public/images/` 혹은 스토리지)에 저장하고, 앱 로드 시 캐싱/가져오기
- **제거/취소 기능**: 머터리얼 아이콘 "Block"을 통해 기존에 선택한 감정 취소 기능
- **뷰어 크기**: 감정 이미지는 `24px` x `24px`
- **단일 선택**: 사용자는 여러 세트의 감정 중 단 1개만 선택 가능
- **파일명 규칙**: `images/em_{세트이름}_{감정}.png` (예: `em_emoji_good.png`, `em_uimin_good.png`)

---

## 3. 구현 계획 상세

### 3.1. 데이터 및 타입 정의 (`src/types.ts`)
확장성을 고려해 감정 세트 메타데이터에 대한 구조를 구성합니다. 데이터베이스(`emotion_entries.emotion`)에는 기존 텍스트 대신 `em_emoji_good`와 같은 **식별자(ID)**를 저장하도록 그대로 사용(TEXT 유지)하거나, 호환성을 관리합니다.

```typescript
export type EmotionType = 'good' | 'curious' | 'normal' | 'sad' | 'angry' | string;

export interface EmotionItem {
  id: string;        // "em_emoji_good"
  type: EmotionType; // "good"
  imageUrl: string;  // "/images/em_emoji_good.png" (서버 URL)
}

export interface EmotionSet {
  setId: string;     // "emoji", "uimin"
  emotions: EmotionItem[];
}
```

### 3.2. 상태 관리 및 서버 로딩 (`src/contexts/DataContext.tsx` 등)
- 첫 로드 시 감정 세트 목록(배열)을 생성하거나 또는 서버/DB의 설정(Config)에서 가져와서 앱 내 전역 데이터로 보유합니다.
- 이미지들의 빠른 표시를 위해 `new Image().src = ...` 방식으로 백그라운드에서 Preload(사전 로드) 처리하는 것도 고려합니다.

### 3.3. 모달 UI 개편 (`src/components/EmotionModal.tsx`)
- 기존 1차원 배열 `EMOJIS`를 제거하고, `EmotionSet[]` 타입의 데이터를 받아 렌더링합니다.
- **제거 아이콘 (Block) 추가**: 모달 내부 우측 상단이나 아이템 영역의 마지막 부분에 Material Icon의 `<span className="material-icons">block</span>`을 배치. 클릭 시 특정 식별자 값을 초기화(`null` 이나 빈 값)하도록 `onSelect` 이벤트 수정.
- **2줄 렌더링**: 세트 별로 한 줄(Row)을 차지하도록 `.map()` 처리 시 `flex-direction: row` 단위를 묶어줍니다.
- **스타일링 (`EmotionModal.module.css`)**:
  - `img` 크기는 `width: 24px; height: 24px; object-fit: contain;`
  - Block 아이콘도 비슷하게 24px 영역과 정렬 조화.

### 3.4. 감정 표시부 개편 (`WeekCard.tsx`, `Calendar` 등)
- 화면에서 감정을 표시해주던 부분에서 기존에는 단순히 이모지 텍스트를 출력했습니다.
- 개편 후에는 `entry.emotion` (예: `em_emoji_good`) 값을 확인하여, 매칭되는 감정의 `imageUrl`을 찾아 `<img>` 컴포넌트로 렌더링하게 변경합니다.
- 백워드 호환성을 처리하지 않고, 대신 DB에 저장된 예전의 이모지 문자들을 새로운 PNG 식별자로 모두 일괄 업데이트(마이그레이션)합니다.

### 3.5. 과거 데이터 일괄 마이그레이션 (DB 스크립트 작성)
- 기존 이모지 8가지를 5가지 감정(Set: emoji)으로 매핑하여 영구 업데이트를 진행합니다.
- 매핑 예시 (Supabase SQL 스크립트를 통해 일괄 변환):
  - 😀 (기쁨), 🥰 (사랑), 😎 (멋짐) ➡️ `em_emoji_good`
  - 😅 (당황), 😴 (피곤) ➡️ `em_emoji_normal`
  - 🥲 (감동/슬픔) ➡️ `em_emoji_sad`
  - 😡 (화남) ➡️ `em_emoji_angry`
  - 😱 (놀람/경악) ➡️ `em_emoji_curious`

### 3.6. 데이터 저장 API 연동 (`src/services/api.ts`)
- Block (제거) 액션 발생 시 DB에서 해당 항목을 `DELETE` 하거나, 빈 값으로 갱신하는 로직 확인.
  (현재는 `upsert`만 하거나 `onDelete` API를 호출하는 로직이 있을텐데, 명시적인 삭제 호출을 뷰와 연결합니다.)

---

## 4. 진행 순서 요약
1. `public/images/` 디렉토리 구성 및 샘플 PNG 이미지를 배치 (혹은 자리표시자 확보)
2. `types.ts`에 확장성 있는 `EmotionSet`, `EmotionItem` 인터페이스 설계
3. `DataContext` 또는 상위 컴포넌트에 감정 세트 데이터 주입 구조 준비
4. UI 변경: `EmotionModal.tsx` / `EmotionModal.module.css` (선택, Block, 줄 구분, 24px)
5. 화면 표시부 변경: `WeekCard.tsx` 등 이모지 표시 영역에 `<img>` 지원
6. 기존 데이터 호환성 검증 및 API의 `upsert`/`delete` 동작 테스트
