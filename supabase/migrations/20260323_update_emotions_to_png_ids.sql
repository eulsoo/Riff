-- 기존 8개의 이모지를 새로운 이미지 식별자로 일괄 업데이트 (DB 마이그레이션)

-- 기쁨/사랑/여유 -> em_emoji_good
UPDATE emotion_entries
SET emotion = 'em_emoji_good'
WHERE emotion IN ('😀', '🥰', '😎');

-- 당황/졸림 -> em_emoji_normal
UPDATE emotion_entries
SET emotion = 'em_emoji_normal'
WHERE emotion IN ('😅', '😴');

-- 슬픔/눈물 -> em_emoji_sad
UPDATE emotion_entries
SET emotion = 'em_emoji_sad'
WHERE emotion IN ('🥲');

-- 화남 -> em_emoji_angry
UPDATE emotion_entries
SET emotion = 'em_emoji_angry'
WHERE emotion IN ('😡');

-- 놀람/경악 -> em_emoji_curious
UPDATE emotion_entries
SET emotion = 'em_emoji_curious'
WHERE emotion IN ('😱');
