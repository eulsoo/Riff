import { useRef, useState } from 'react';
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

const VIEW_SIZE = 240; // 프리뷰 정사각 크기
const OUTPUT_SIZE = 200; // 최종 썸네일 크기
const MAX_DIMENSION = 512; // 업로드 이미지 리사이즈 최대 크기

export function SettingsModal({ onClose, initialAvatarUrl, initialWeekOrder, onSaved }: SettingsModalProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(initialAvatarUrl || null);
  const [weekOrder, setWeekOrder] = useState<WeekOrder>(initialWeekOrder);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [startOffset, setStartOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일을 선택해주세요.');
      return;
    }
    const resized = await resizeToMax(file, MAX_DIMENSION);
    const dataUrl = await blobToDataUrl(resized);
    setImageSrc(dataUrl);
    setAvatarChanged(true);
    resetTransform();
  };

  const resetTransform = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageSrc) return;
    setDragging(true);
    setStartPos({ x: e.clientX, y: e.clientY });
    setStartOffset(offset);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = e.clientX - startPos.x;
    const dy = e.clientY - startPos.y;
    const candidate = { x: startOffset.x + dx, y: startOffset.y + dy };
    setOffset(clampOffset(candidate, scale, imgRef.current, imgSize));
  };

  const handleMouseUp = () => setDragging(false);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!imageSrc) return;
    e.preventDefault();
    const delta = -e.deltaY;
    setScale((prev) => {
      const next = prev + delta * 0.0015;
      const clamped = Math.min(Math.max(0.5, next), 3);
      setOffset((prevOffset) => clampOffset(prevOffset, clamped, imgRef.current, imgSize));
      return clamped;
    });
  };

  const computeBaseScale = () => {
    if (!imgRef.current) return 1;
    const w = imgRef.current.naturalWidth;
    const h = imgRef.current.naturalHeight;
    const base = VIEW_SIZE / Math.min(w, h);
    return base;
  };

  const clampOffset = (
    candidate: { x: number; y: number },
    nextScale: number,
    imgEl: HTMLImageElement | null,
    size: { w: number; h: number }
  ) => {
    const w = size.w || imgEl?.naturalWidth || 0;
    const h = size.h || imgEl?.naturalHeight || 0;
    if (!w || !h) return candidate;
    const base = VIEW_SIZE / Math.min(w, h);
    const renderScale = base * nextScale;
    const renderW = w * renderScale;
    const renderH = h * renderScale;
    const maxX = Math.max(0, (renderW - VIEW_SIZE) / 2);
    const maxY = Math.max(0, (renderH - VIEW_SIZE) / 2);
    return {
      x: Math.min(Math.max(candidate.x, -maxX), maxX),
      y: Math.min(Math.max(candidate.y, -maxY), maxY),
    };
  };

  const handleImageLoad = () => {
    if (!imgRef.current) return;
    setImgSize({
      w: imgRef.current.naturalWidth,
      h: imgRef.current.naturalHeight,
    });
    resetTransform();
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

    if (!imageSrc.startsWith('data:')) {
      alert('이미지 처리에 실패했습니다. 다시 이미지를 선택해주세요.');
      onSaved({ avatarUrl: initialAvatarUrl || null, weekOrder });
      onClose();
      return;
    }

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = VIEW_SIZE;
    previewCanvas.height = VIEW_SIZE;
    const ctx = previewCanvas.getContext('2d');
    if (!ctx) return;

    const baseScale = computeBaseScale();
    const renderScale = baseScale * scale;
    const img = imgRef.current;

    ctx.save();
    ctx.translate(VIEW_SIZE / 2 + offset.x, VIEW_SIZE / 2 + offset.y);
    ctx.scale(renderScale, renderScale);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = OUTPUT_SIZE;
    finalCanvas.height = OUTPUT_SIZE;
    const fctx = finalCanvas.getContext('2d');
    if (!fctx) return;
    fctx.drawImage(previewCanvas, 0, 0, VIEW_SIZE, VIEW_SIZE, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    let blob: Blob | null = null;
    try {
      blob = await new Promise<Blob | null>((resolve) =>
        finalCanvas.toBlob((b) => resolve(b), 'image/png')
      );
    } catch (error) {
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

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBackdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>설정</h2>
          <button className={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        <div className={styles.section}>
          <p className={styles.sectionTitle}>프로필 이미지</p>
          <div className={styles.previewRow}>
            <div className={styles.avatarPreview}>
              {imageSrc ? (
                <img
                  ref={imgRef}
                  src={imageSrc}
                  alt="avatar"
                  style={{
                    transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${computeBaseScale() * scale})`,
                  }}
                  className={styles.previewImage}
                  onLoad={handleImageLoad}
                />
              ) : (
                <div className={styles.placeholder}>No Image</div>
              )}
              <div
                className={styles.dragLayer}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
              />
            </div>
            <div className={styles.controls}>
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
              <label className={styles.sliderLabel}>확대/축소</label>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.01}
                value={scale}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setScale(next);
                  setOffset((prev) => clampOffset(prev, next, imgRef.current, imgSize));
                }}
              />
              <button className={styles.resetButton} onClick={resetTransform}>
                위치 초기화
              </button>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <p className={styles.sectionTitle}>주간 순서 조정</p>
          <div className={styles.weekOrderOptions}>
            <label className={styles.weekOrderOption}>
              <input
                type="radio"
                name="weekOrder"
                value="mon"
                checked={weekOrder === 'mon'}
                onChange={() => setWeekOrder('mon')}
              />
              <span>월 ~ 일</span>
            </label>
            <label className={styles.weekOrderOption}>
              <input
                type="radio"
                name="weekOrder"
                value="sun"
                checked={weekOrder === 'sun'}
                onChange={() => setWeekOrder('sun')}
              />
              <span>일 ~ 토</span>
            </label>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.cancelButton} onClick={onClose}>취소</button>
          <button className={styles.saveButton} onClick={handleSave}>저장</button>
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
