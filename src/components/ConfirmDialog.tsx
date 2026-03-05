import { useEffect, useRef, ReactNode } from 'react';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  onClose?: () => void;
  children?: ReactNode;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = '확인',
  cancelText = '취소',
  onConfirm,
  onCancel,
  onClose,
  children,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose?.() || onCancel?.();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.() || onCancel?.();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onConfirm, onCancel, onClose]);

  if (!isOpen) return null;

  return (
    <div id="confirm-dialog-container" className={styles.overlay}>
      <div ref={dialogRef} className={styles.dialog}>
        {title && <h3 className={styles.title}>{title}</h3>}
        {message && <p className={styles.message} style={{ whiteSpace: 'pre-wrap' }}>{message}</p>}
        {children}
        <div className={styles.buttonContainer}>
          {onCancel && (
            <button
              className={styles.cancelButton}
              onClick={onCancel}
            >
              {cancelText}
            </button>
          )}
          <button
            className={styles.confirmButton}
            onClick={onConfirm}
            autoFocus
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
