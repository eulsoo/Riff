import { useState, useRef, useEffect } from 'react';
import styles from './EmotionModal.module.css';
import { EMOTION_SETS } from '../constants/emotions';

export interface ModalPosition {
  top: number;
  left?: number;
  right?: number;
}

interface EmotionModalProps {
  date: string;
  position: ModalPosition | null;
  currentEmotion?: string;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}

export function EmotionModal({ date, position, currentEmotion, onSelect, onClose }: EmotionModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [selectedEmotionId, setSelectedEmotionId] = useState<string | null>(currentEmotion || null);

  // Close when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [onClose]);

  if (!position) return null;

  return (
    <div
      ref={modalRef}
      className={styles.emotionPopup}
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        right: position.right,
      }}
    >
      <div className={styles.setsContainer}>
        {EMOTION_SETS.map((emotionSet) => (
          <div key={emotionSet.setId} className={styles.emotionRow}>
            {emotionSet.emotions.map((emotion) => (
              <button
                key={emotion.id}
                type="button"
                className={`${styles.emojiButton} ${selectedEmotionId === emotion.id ? styles.selected : ''}`}
                onClick={() => {
                  if (selectedEmotionId === emotion.id) {
                    setSelectedEmotionId(null);
                  } else {
                    setSelectedEmotionId(emotion.id);
                  }
                }}
              >
                <img src={emotion.imageUrl} alt={emotion.type} className={styles.emotionImage} />
              </button>
            ))}
          </div>
        ))}
        {/* Confirm Button Row */}
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.confirmButton}
            onClick={() => {
              onSelect(selectedEmotionId);
              onClose();
            }}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
