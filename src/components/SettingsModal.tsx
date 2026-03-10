import { useCallback, useEffect, useRef, useState } from 'react';
import shared from './SharedModal.module.css';
import styles from './SettingsModal.module.css';
import { WeekOrder } from '../types';
import { uploadAvatar, saveUserAvatar } from '../services/api';
import { supabase } from '../lib/supabase';

interface SettingsModalProps {
  onClose: () => void;
  initialAvatarUrl?: string | null;
  initialWeekOrder: WeekOrder;
  onSaved: (data: { avatarUrl: string | null; weekOrder: WeekOrder }) => void;
}

const VIEW_SIZE = 120;
const OUTPUT_SIZE = 200;
const MAX_DIMENSION = 512;

// 프리뷰와 저장이 공유하는 단 하나의 크롭 계산 함수
function getSourceRect(
  img: HTMLImageElement,
  userScale: number,
  offset: { x: number; y: number }
) {
  const base = VIEW_SIZE / Math.min(img.naturalWidth, img.naturalHeight);
  const renderScale = base * userScale;
  const sw = VIEW_SIZE / renderScale;
  const sh = VIEW_SIZE / renderScale;
  const sx = -(VIEW_SIZE / 2 + offset.x) / renderScale + img.naturalWidth / 2;
  const sy = -(VIEW_SIZE / 2 + offset.y) / renderScale + img.naturalHeight / 2;
  return { sx, sy, sw, sh };
}

export function SettingsModal({ onClose, initialAvatarUrl, initialWeekOrder, onSaved }: SettingsModalProps) {
  const [displayAvatarUrl] = useState<string | null>(initialAvatarUrl || null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [weekOrder, setWeekOrder] = useState<WeekOrder>(initialWeekOrder);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [startOffset, setStartOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offsetRef = useRef(offset);
  const scaleRef = useRef(scale);
  offsetRef.current = offset;
  scaleRef.current = scale;

  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.naturalWidth) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const { sx, sy, sw, sh } = getSourceRect(img, scaleRef.current, offsetRef.current);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, VIEW_SIZE, VIEW_SIZE);
    ctx.restore();
  }, []);

  // offset이나 scale이 바뀔 때 canvas 갱신
  useEffect(() => {
    if (imageSrc) drawPreview();
  }, [offset.x, offset.y, scale, imageSrc, drawPreview]);

  const clampOffset = (
    candidate: { x: number; y: number },
    nextScale: number,
    imgEl: HTMLImageElement | null
  ) => {
    const w = imgEl?.naturalWidth || 0;
    const h = imgEl?.naturalHeight || 0;
    if (!w || !h) return candidate;
    const base = VIEW_SIZE / Math.min(w, h);
    const renderScale = base * nextScale;
    const maxX = Math.max(0, (w * renderScale - VIEW_SIZE) / 2);
    const maxY = Math.max(0, (h * renderScale - VIEW_SIZE) / 2);
    return {
      x: Math.min(Math.max(candidate.x, -maxX), maxX),
      y: Math.min(Math.max(candidate.y, -maxY), maxY),
    };
  };

  const resetTransform = useCallback(() => {
    const zero = { x: 0, y: 0 };
    setScale(1);
    setOffset(zero);
    scaleRef.current = 1;
    offsetRef.current = zero;
  }, []);

  const handleImageLoad = useCallback(() => {
    resetTransform();
    // resetTransform은 state 업데이트 → useEffect가 drawPreview를 호출함
  }, [resetTransform]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일을 선택해주세요.');
      return;
    }
    const resized = await resizeToMax(file, MAX_DIMENSION);
    const dataUrl = await blobToDataUrl(resized);
    resetTransform();
    setImageSrc(dataUrl);
    setAvatarChanged(true);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setDragging(true);
    setStartPos({ x: e.clientX, y: e.clientY });
    setStartOffset(offsetRef.current);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = e.clientX - startPos.x;
    const dy = e.clientY - startPos.y;
    const candidate = { x: startOffset.x + dx, y: startOffset.y + dy };
    const next = clampOffset(candidate, scaleRef.current, imgRef.current);
    setOffset(next);
    offsetRef.current = next;
    setAvatarChanged(true);
  };

  const handleMouseUp = () => setDragging(false);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const nextScale = Math.min(Math.max(0.5, scaleRef.current + (-e.deltaY) * 0.0015), 3);
    const nextOffset = clampOffset(offsetRef.current, nextScale, imgRef.current);
    setScale(nextScale);
    setOffset(nextOffset);
    scaleRef.current = nextScale;
    offsetRef.current = nextOffset;
    setAvatarChanged(true);
  };

  const handleSave = async () => {
    if (!avatarChanged) {
      onSaved({ avatarUrl: initialAvatarUrl || null, weekOrder });
      onClose();
      return;
    }

    if (!imageSrc || !imgRef.current) {
      onSaved({ avatarUrl: initialAvatarUrl || null, weekOrder });
      onClose();
      return;
    }

    const img = imgRef.current;
    const { sx, sy, sw, sh } = getSourceRect(img, scaleRef.current, offsetRef.current);

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = OUTPUT_SIZE;
    finalCanvas.height = OUTPUT_SIZE;
    const ctx = finalCanvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    let blob: Blob | null = null;
    try {
      blob = await new Promise<Blob | null>((resolve, reject) => {
        try {
          finalCanvas.toBlob((b) => resolve(b), 'image/png');
        } catch (e) {
          reject(e);
        }
      });
    } catch {
      alert('이미지 처리 중 오류가 발생했습니다. 주간 순서만 저장됩니다.');
      onSaved({ avatarUrl: initialAvatarUrl || null, weekOrder });
      onClose();
      return;
    }
    if (!blob) {
      alert('썸네일 생성에 실패했습니다.');
      return;
    }

    const file = new File([blob], 'avatar.png', { type: 'image/png' });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('로그인 후 이용해주세요.');
      return;
    }

    const url = await uploadAvatar(file, user.id);
    if (url) {
      const saved = await saveUserAvatar(url);
      if (saved) {
        onSaved({ avatarUrl: url, weekOrder });
      }
    }
    onClose();
  };

  const dpr = window.devicePixelRatio || 1;

  return (
    <div className={shared.modalOverlay}>
      <div className={shared.modalBackdrop} onClick={onClose} />

      <div className={shared.modal}>
        {/* Header */}
        <div className={shared.modalHeader}>
          <div className={shared.modalHeaderSpacer} />
          <div className={shared.modalTitle}>프로필 설정</div>
          <div className={shared.modalHeaderSpacerEnd}>
            <button onClick={onClose} className={shared.modalCloseButton}>
              <span className={`material-symbols-rounded ${shared.modalCloseIcon}`}>close</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={shared.modalContent}>
          {/* 프로필 이미지 */}
          <div className={shared.section}>
            <p className={shared.sectionTitle}>프로필 이미지</p>
            <div className={styles.avatarSection}>

              {/* 이미지 로딩 전용 hidden img */}
              {imageSrc && (
                <img
                  ref={imgRef}
                  src={imageSrc}
                  style={{ display: 'none' }}
                  crossOrigin="anonymous"
                  onLoad={handleImageLoad}
                  alt=""
                />
              )}

              <div className={styles.avatarPreview}>
                {imageSrc ? (
                  <canvas
                    ref={canvasRef}
                    width={VIEW_SIZE * dpr}
                    height={VIEW_SIZE * dpr}
                    style={{ width: VIEW_SIZE, height: VIEW_SIZE }}
                    className={styles.previewCanvas}
                  />
                ) : displayAvatarUrl ? (
                  <img src={displayAvatarUrl} className={styles.savedAvatarDisplay} alt="현재 프로필" />
                ) : (
                  <div className={styles.placeholder}>No Image</div>
                )}
                {imageSrc && (
                  <div
                    className={styles.dragLayer}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onWheel={handleWheel}
                  />
                )}
              </div>

              <div className={styles.avatarControls}>
                <div className={styles.avatarButtons}>
                  <button
                    className={styles.uploadButton}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    이미지 선택
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className={styles.hiddenInput}
                    onChange={handleFileSelect}
                  />
                  {imageSrc && (
                    <button className={styles.resetButton} onClick={resetTransform}>
                      위치 초기화
                    </button>
                  )}
                </div>

                {imageSrc && (
                  <div className={styles.zoomRow}>
                    <span className={styles.zoomLabel}>축소</span>
                    <input
                      type="range"
                      min={0.5}
                      max={3}
                      step={0.01}
                      value={scale}
                      className={styles.zoomSlider}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        const nextOffset = clampOffset(offsetRef.current, next, imgRef.current);
                        setScale(next);
                        setOffset(nextOffset);
                        scaleRef.current = next;
                        offsetRef.current = nextOffset;
                        setAvatarChanged(true);
                      }}
                    />
                    <span className={styles.zoomLabel}>확대</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className={shared.primaryButton} onClick={handleSave}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

async function resizeToMax(file: File, maxSize: number): Promise<Blob> {
  const dataUrl = await blobToDataUrl(file);
  const img = await loadImage(dataUrl);
  const { width, height } = img;
  const ratio = Math.min(1, maxSize / Math.max(width, height));
  const targetW = Math.round(width * ratio);
  const targetH = Math.round(height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b || file), 'image/png')
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
