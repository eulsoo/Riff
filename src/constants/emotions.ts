import { EmotionSet } from '../types';

export const EMOTION_SETS: EmotionSet[] = [
  {
    setId: 'emoji',
    emotions: [
      { id: 'em_emoji_good', type: 'good', imageUrl: '/images/em_emoji_good.png' },
      { id: 'em_emoji_curious', type: 'curious', imageUrl: '/images/em_emoji_curious.png' },
      { id: 'em_emoji_normal', type: 'normal', imageUrl: '/images/em_emoji_normal.png' },
      { id: 'em_emoji_sad', type: 'sad', imageUrl: '/images/em_emoji_sad.png' },
      { id: 'em_emoji_angry', type: 'angry', imageUrl: '/images/em_emoji_angry.png' },
    ],
  },
  {
    setId: 'uimin',
    emotions: [
      { id: 'em_uimin_good', type: 'good', imageUrl: '/images/em_uimin_good.png' },
      { id: 'em_uimin_curious', type: 'curious', imageUrl: '/images/em_uimin_curious.png' },
      { id: 'em_uimin_normal', type: 'normal', imageUrl: '/images/em_uimin_normal.png' },
      { id: 'em_uimin_sad', type: 'sad', imageUrl: '/images/em_uimin_sad.png' },
      { id: 'em_uimin_angry', type: 'angry', imageUrl: '/images/em_uimin_angry.png' },
    ],
  },
];

export const getEmotionImageById = (id: string | undefined): string | null => {
  if (!id) return null;
  for (const set of EMOTION_SETS) {
    const emotionItem = set.emotions.find((e) => e.id === id);
    if (emotionItem) return emotionItem.imageUrl;
  }
  return null;
};
