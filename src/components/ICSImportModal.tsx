import { useState, useRef } from 'react';
import { X, Upload } from 'lucide-react';
import { importICSFile } from '../services/icsParser';
import styles from './ICSImportModal.module.css';

interface ICSImportModalProps {
  onClose: () => void;
  onImportComplete: (count: number) => void;
}

export function ICSImportModal({ onClose, onImportComplete }: ICSImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.name.endsWith('.ics') || selectedFile.name.endsWith('.ical')) {
        setFile(selectedFile);
        setError(null);
      } else {
        setError('ICS 파일만 업로드할 수 있습니다. (.ics 또는 .ical 확장자)');
        setFile(null);
      }
    }
  };

  const handleImport = async () => {
    if (!file) {
      setError('파일을 선택해주세요.');
      return;
    }

    setImporting(true);
    setError(null);
    
    try {
      const count = await importICSFile(file);
      onImportComplete(count);
      onClose();
    } catch (err: any) {
      setError(err.message || '파일을 가져올 수 없습니다.');
    } finally {
      setImporting(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      if (droppedFile.name.endsWith('.ics') || droppedFile.name.endsWith('.ical')) {
        setFile(droppedFile);
        setError(null);
      } else {
        setError('ICS 파일만 업로드할 수 있습니다.');
      }
    }
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBackdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>ICS 파일 가져오기</h2>
          <button onClick={onClose} className={styles.modalCloseButton}>
            <X className={styles.modalCloseIcon} />
          </button>
        </div>

        <div className={styles.modalContent}>
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>파일 선택</h3>
            <p className={styles.helpText}>
              macOS Calendar.app에서 내보낸 ICS 파일을 선택하세요.
            </p>
            
            <div
              className={styles.dropZone}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".ics,.ical"
                onChange={handleFileSelect}
                className={styles.fileInput}
              />
              
              {file ? (
                <div className={styles.fileInfo}>
                  <Upload className={styles.uploadIcon} />
                  <div>
                    <div className={styles.fileName}>{file.name}</div>
                    <div className={styles.fileSize}>
                      {(file.size / 1024).toFixed(2)} KB
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.dropZoneContent}>
                  <Upload className={styles.uploadIconLarge} />
                  <p>파일을 드래그하거나 클릭하여 선택</p>
                  <p className={styles.dropZoneHint}>.ics 또는 .ical 파일</p>
                </div>
              )}
            </div>

            {file && (
              <div className={styles.actions}>
                <button
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                  className={styles.cancelButton}
                  disabled={importing}
                >
                  파일 제거
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className={styles.importButton}
                >
                  {importing ? '가져오는 중...' : '가져오기'}
                </button>
              </div>
            )}

            {error && (
              <div className={styles.errorMessage}>{error}</div>
            )}
          </div>

          <div className={styles.instructions}>
            <h4 className={styles.instructionsTitle}>macOS Calendar.app에서 내보내기:</h4>
            <ol className={styles.instructionsList}>
              <li>Calendar.app을 엽니다</li>
              <li>내보낼 캘린더를 선택합니다</li>
              <li>파일 → 내보내기 → 캘린더 내보내기</li>
              <li>저장된 .ics 파일을 여기서 선택합니다</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
