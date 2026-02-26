import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import styles from './EmotionModal.module.css';

export interface ModalPosition {
  top: number;
  left?: number;
  right?: number;
}

interface EmotionModalProps {
  date: string;
  position: ModalPosition | null;
  currentEmotion?: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const EMOJIS = ['😀', '🥰', '😎', '😅', '🥲', '😡', '😱', '😴'];

export function EmotionModal({ date, position, currentEmotion, onSelect, onClose }: EmotionModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

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
      {EMOJIS.map(emoji => (
        <button
          key={emoji}
          type="button"
          className={`${styles.emojiButton} ${currentEmotion === emoji ? styles.selected : ''}`}
          onClick={() => {
            onSelect(emoji);
            onClose();
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
