# 구글 머티리얼 심볼 (Google Material Symbols) - 스타일링 가이드

머티리얼 심볼은 **가변 폰트(Variable Fonts)**입니다. 즉, "굵은체"나 "테두리체" 폰트 파일을 별도로 로드할 필요가 없습니다. 대신 CSS의 `font-variation-settings` 속성을 사용하여 모양을 자유롭게 제어할 수 있습니다.

## 1. 4가지 설정 축 (Axes)

CSS 문자열 내에서 이 4가지 값을 동시에 조절할 수 있습니다.

### 1. `'FILL'` (채움 상태)
아이콘의 내부를 채울지, 테두리만 표시할지 결정합니다.
- **`0`**: 테두리만 (기본값)
- **`1`**: 채워짐
- *사용 팁: 활성화된 상태나 선택된 항목을 강조할 때 `1`을 사용하세요.*

### 2. `'wght'` (두께 - Weight)
획의 두께를 조절합니다.
- **범위**: `100` (얇음) ~ `700` (굵음)
- **표준값**: `400`
- *참고: 가변 폰트에서는 일반적인 CSS `font-weight` 속성이 항상 정확하게 적용되지 않을 수 있습니다. 여기서 `'wght'`를 사용하는 것이 가장 확실한 방법입니다.*

### 3. `'GRAD'` (그레이드 - Grade)
**레이아웃 너비를 변경하지 않고** 두께를 미세하게 조정합니다. 시각적 보정에 유용합니다.
- **`-25`**: 고대비 / 다크 모드 (빛 번짐을 상쇄하기 위해 글자를 약간 얇게 보이게 함)
- **`0`**: 기본 (Normal)
- **`200`**: 저대비 (글자를 약간 더 굵게 보이게 함)

### 4. `'opsz'` (광학적 크기 - Optical Size)
아이콘의 크기에 맞춰 획의 디테일을 최적화합니다.
- **범위**: `20` ~ `48`
- **표준값**: `24`
- *팁: 최상의 결과를 위해 이 값을 실제 `font-size`와 일치시키세요 (예: `font-size: 20px`이면 `'opsz' 20` 사용).*

---

## 2. CSS 문법 예시 (CSS Syntax Examples)

### 기본 설정 (Basic Setup)
모든 브라우저에서 일관된 렌더링을 위해 항상 4가지 축을 모두 정의하는 것이 좋습니다.

```css
.material-symbols-rounded {
  /* ...기타 폰트 속성... */
  
  /* 문법: '축이름' 값, '축이름' 값 ... */
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}
```

### 예시: 굵게 & 채움 (예: 활성 탭)
```css
.active-icon {
  font-variation-settings: 'FILL' 1, 'wght' 700, 'GRAD' 0, 'opsz' 24;
  color: #3b82f6;
}
```

### 예시: 얇게 & 테두리 (예: 비활성/사용 불가 상태)
```css
.inactive-icon {
  font-variation-settings: 'FILL' 0, 'wght' 200, 'GRAD' 0, 'opsz' 24;
  color: #9ca3af;
}
```

### 예시: 호버 애니메이션 (Hover Animation)
이 값들은 숫자이므로, CSS `transition`을 통해 부드럽게 애니메이션할 수 있습니다!

```css
.icon-button {
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  transition: font-variation-settings 0.3s ease;
}

.icon-button:hover {
  /* 부드럽게 아이콘이 채워지고 약간 더 굵어짐 */
  font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24;
}
```

---

## 3. 빠른 참조표 (Quick Reference)

| 속성 | 키(Key) | 값(Values) | 설명 |
| :--- | :--- | :--- | :--- |
| **채움 (Fill)** | `'FILL'` | `0`, `1` | 테두리(0) vs 채움(1) |
| **두께 (Weight)** | `'wght'` | `100` - `700` | 획의 두께 |
| **그레이드 (Grade)** | `'GRAD'` | `-25`, `0`, `200` | 시각적 무게감 보정 |
| **광학 크기 (Optical Size)** | `'opsz'` | `20` - `48` | 크기에 따른 디테일 최적화 |
