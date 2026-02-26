import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { HexColorPicker } from 'react-colorful';
import { CalendarMetadata } from '../services/api';
import styles from './CalendarListPopup.module.css';

export interface CalendarListPopupProps {
  calendars: CalendarMetadata[];
  visibleUrlSet: Set<string>;
  onToggle: (url: string) => void;
  onClose: () => void;
  onAddLocalCalendar?: (name: string, color: string) => string;
  onUpdateLocalCalendar?: (url: string, updates: Partial<CalendarMetadata>) => void;
  onDeleteCalendar?: (url: string) => void;
  onSyncToMac?: (calendar: CalendarMetadata) => void;
  onOpenCalDAVModal?: () => void;
  onOpenSubscribeModal?: () => void;
  onShowToast?: (message: string, type: 'success' | 'error') => void;
}

// 충분히 다양한 색상 풀
const COLOR_POOL = [
  '#ff3b30', '#ff6b6b', '#ff9500', '#ffcc00', '#ffd700',
  '#4cd964', '#34c759', '#00c7be', '#5ac8fa', '#007aff',
  '#0a84ff', '#5e5ce6', '#5856d6', '#af52de', '#ff2d55',
  '#a2845e', '#8e8e93', '#636366', '#2c2c2e', '#e91e63',
  '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4',
  '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39',
  '#ffc107', '#ff9800', '#ff5722', '#795548', '#607d8b',
  '#b71c1c', '#880e4f', '#4a148c', '#1a237e', '#0d47a1',
  '#006064', '#1b5e20', '#33691e', '#827717', '#e65100',
];

// 사용 중인 색상 set 반환
function getUsedColors(calendars: CalendarMetadata[]): Set<string> {
  return new Set(calendars.map(c => (c.color || '').toLowerCase()));
}

// 사용 중이지 않은 색상 N개 뽑기 (exclude 추가 제외)
function pickUnusedColors(usedColors: Set<string>, count: number, exclude: string[] = []): string[] {
  const excludeSet = new Set([...Array.from(usedColors), ...exclude.map(c => c.toLowerCase())]);
  const result: string[] = [];
  for (const c of COLOR_POOL) {
    if (result.length >= count) break;
    if (!excludeSet.has(c.toLowerCase())) result.push(c);
  }
  // 풀이 부족하면 다시 풀 전체에서 채움
  if (result.length < count) {
    for (const c of COLOR_POOL) {
      if (result.length >= count) break;
      if (!result.includes(c)) result.push(c);
    }
  }
  return result;
}

// 캘린더 아이템 렌더링 함수
const renderCalendarItem = (
  cal: CalendarMetadata,
  isLocalSection: boolean,
  visibleUrlSet: Set<string>,
  editingId: string | null,
  editingName: string,
  selectedId: string | null,
  inputRef: React.RefObject<HTMLInputElement | null>,
  onToggle: (url: string) => void,
  handleContextMenu: (e: React.MouseEvent, cal: CalendarMetadata) => void,
  setSelectedId: (id: string | null) => void,
  setEditingId: (id: string | null) => void,
  setEditingName: (name: string) => void,
  handleNameSave: () => void,
  handleKeyDown: (e: React.KeyboardEvent) => void
) => {
  const normalizedUrl = cal.url.replace(/\/+$/, '') || cal.url;
  const isVisible = visibleUrlSet.has(normalizedUrl);
  const isEditing = editingId === cal.url;
  const isSelected = selectedId === cal.url;

  return (
    <div
      key={cal.url}
      className={styles.calendarItem}
      style={{ backgroundColor: isSelected ? 'rgba(0, 0, 0, 0.05)' : undefined }}
      onContextMenu={(e) => handleContextMenu(e, cal)}
      onClick={() => {
        if (isSelected && isLocalSection && cal.isLocal && !isEditing) {
          setEditingId(cal.url);
          setEditingName(cal.displayName);
          return;
        }
        setSelectedId(cal.url);
      }}
    >
      <input
        type="checkbox"
        className={styles.checkbox}
        style={{ '--cal-color': cal.color } as React.CSSProperties}
        checked={isVisible}
        onChange={() => onToggle(cal.url)}
        onClick={(e) => e.stopPropagation()}
      />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
        {isEditing ? (
          <input
            ref={inputRef}
            className={styles.calendarNameInput}
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={styles.calendarName}
            style={{ userSelect: 'none' }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (isLocalSection && cal.isLocal) {
                setEditingId(cal.url);
                setEditingName(cal.displayName);
              }
            }}
          >
            {cal.displayName}
          </span>
        )}
      </div>

      <div className={styles.shareStatus}>
        {cal.createdFromApp && (
          <>
            <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>arrow_forward</span>
            <span>iCloud</span>
          </>
        )}
      </div>
    </div>
  );
};

function CalendarListPopupComponent({
  calendars,
  visibleUrlSet,
  onToggle,
  onClose,
  onAddLocalCalendar,
  onUpdateLocalCalendar,
  onDeleteCalendar,
  onSyncToMac,
  onOpenCalDAVModal,
  onOpenSubscribeModal,
  onShowToast,
}: CalendarListPopupProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; calendarUrl: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 색상 관련 상태: 인덱스 0 = 현재 색, 1~7 = 미사용 색
  const [showHexPicker, setShowHexPicker] = useState(false);
  const [suggestedColors, setSuggestedColors] = useState<string[]>([]);
  const [subscriptionSettingsCalUrl, setSubscriptionSettingsCalUrl] = useState<string | null>(null);

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // context menu가 열릴 때: 슬롯 0 = 현재 캘린더 색, 슬롯 1~7 = 미사용 샄8 7개
  useEffect(() => {
    if (contextMenu) {
      const currentColor = calendars.find(c => c.url === contextMenu.calendarUrl)?.color || '#3b82f6';
      const usedColors = getUsedColors(calendars);
      const unused7 = pickUnusedColors(usedColors, 7, [currentColor]);
      setSuggestedColors([currentColor, ...unused7]); // [0]=현재색, [1~7]=미사용
      setShowHexPicker(false);
    }
  }, [contextMenu, calendars]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
        setShowHexPicker(false);
      }

      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        const caldavModal = document.getElementById('caldav-sync-modal-container');
        if (caldavModal && caldavModal.contains(e.target as Node)) return;
        const subscribeModal = document.getElementById('subscribe-modal-container');
        if (subscribeModal && subscribeModal.contains(e.target as Node)) return;
        const subSettingsPopup = document.getElementById('subscription-settings-popup');
        if (subSettingsPopup && subSettingsPopup.contains(e.target as Node)) return;
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleContextMenu = (e: React.MouseEvent, cal: CalendarMetadata) => {
    e.preventDefault();
    setSelectedId(cal.url);
    setContextMenu({ x: e.clientX, y: e.clientY, calendarUrl: cal.url });
  };

  const handleAddClick = () => {
    if (onAddLocalCalendar) {
      const newUrl = onAddLocalCalendar('무제', '#ff3b30');
      setEditingId(newUrl);
      setEditingName('무제');
    }
  };

  const handleNameSave = () => {
    if (editingId && onUpdateLocalCalendar) {
      onUpdateLocalCalendar(editingId, { displayName: editingName });
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleNameSave();
    else if (e.key === 'Escape') setEditingId(null);
  };

  const handleDelete = () => {
    if (contextMenu && onDeleteCalendar) {
      onDeleteCalendar(contextMenu.calendarUrl);
      setContextMenu(null);
    }
  };

  // 수정 가능한 코드 (인덱스 0은 현재 색 표시용 버튼, 클릭 시 index=0이면 HexPicker 열기)
  const handleChipColorSelect = (color: string, chipIndex: number) => {
    if (!contextMenu || !onUpdateLocalCalendar) return;
    if (chipIndex === 0) {
      // 현재 색 칩 클릭 → HexPicker 열기
      setShowHexPicker(true);
      return;
    }
    // 미사용 색 선택 → 적용 + 해당 슬롯을 새 미사용 색으로 교체
    onUpdateLocalCalendar(contextMenu.calendarUrl, { color });
    setSuggestedColors(prev => {
      const usedColors = getUsedColors(calendars);
      const currentChips = prev.filter((_, i) => i !== chipIndex);
      const newColor = pickUnusedColors(usedColors, 1, [...currentChips, color]);
      const next = [...prev];
      next[chipIndex] = newColor[0] || color;
      return next;
    });
  };

  // HexColorPicker에서 확인 없이 드래그로 변경
  const handleHexColorChange = (color: string) => {
    if (contextMenu && onUpdateLocalCalendar) {
      onUpdateLocalCalendar(contextMenu.calendarUrl, { color });
    }
  };

  // Group calendars
  const groups = useMemo(() => {
    const result = {
      riff: [] as CalendarMetadata[],
      riffFromIcloud: [] as CalendarMetadata[],
      subscription: [] as CalendarMetadata[],
    };

    calendars.forEach(cal => {
      if (cal.url.includes('/inbox/') || cal.url.includes('/outbox/') || cal.url.includes('/notification/')) return;
      if (cal.isSubscription || cal.type === 'subscription' || cal.url.endsWith('.ics') || cal.url.includes('holidays')) {
        result.subscription.push(cal);
        return;
      }
      if (cal.isLocal || cal.createdFromApp) {
        result.riff.push(cal);
        return;
      }
      result.riffFromIcloud.push(cal);
    });

    return result;
  }, [calendars]);

  const currentCalColor = calendars.find(c => c.url === contextMenu?.calendarUrl)?.color || '#3b82f6';

  return (
    <>
      <div className={styles.popupContainer} ref={popupRef}>
        <div className={styles.scrollArea}>
          {calendars.length === 0 ? (
            <div style={{ padding: '1rem 0', fontSize: '0.85rem', color: '#666', textAlign: 'center' }}>
              캘린더가 없습니다.
            </div>
          ) : (
            <>
              {/* 1. Riff */}
              <div className={styles.section}>
                <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Riff</span>
                  <span className={`material-symbols-rounded ${styles.actionIcon}`} style={{ fontVariationSettings: "'wght' 700" }} onClick={handleAddClick}>add_2</span>
                </div>
                {groups.riff.map(cal => renderCalendarItem(
                  cal, true, visibleUrlSet, editingId, editingName, selectedId,
                  inputRef, onToggle, handleContextMenu, setSelectedId,
                  setEditingId, setEditingName, handleNameSave, handleKeyDown
                ))}
              </div>

              {/* 2. iCloud */}
              <div className={styles.section}>
                <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>iCloud</span>
                  </div>
                  <span
                    className={`material-symbols-rounded ${styles.actionIcon}`}
                    style={{ fontSize: '16px', cursor: 'pointer' }}
                    onClick={onOpenCalDAVModal}
                    title="Mac 캘린더 동기화"
                  >cloud_download</span>
                </div>
                {groups.riffFromIcloud.length > 0 ? (
                  groups.riffFromIcloud.map(cal => renderCalendarItem(
                    cal, false, visibleUrlSet, editingId, editingName, selectedId,
                    inputRef, onToggle, handleContextMenu, setSelectedId,
                    setEditingId, setEditingName, handleNameSave, handleKeyDown
                  ))
                ) : (
                  <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#9ca3af' }}>
                    동기화된 캘린더가 없습니다.
                  </div>
                )}
              </div>

              {/* 3. Subscription */}
              <div className={styles.section}>
                <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>구독</span>
                  <span
                    className={`material-symbols-rounded ${styles.actionIcon}`}
                    style={{ fontSize: '16px', cursor: 'pointer' }}
                    onClick={onOpenSubscribeModal}
                    title="URL로 캘린더 가져오기"
                  >cloud_download</span>
                </div>
                {groups.subscription.length > 0 ? (
                  groups.subscription.map(cal => renderCalendarItem(
                    cal, false, visibleUrlSet, editingId, editingName, selectedId,
                    inputRef, onToggle, handleContextMenu, setSelectedId,
                    setEditingId, setEditingName, handleNameSave, handleKeyDown
                  ))
                ) : (
                  <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#9ca3af' }}>
                    구독 중인 캘린더가 없습니다.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Context Menu */}
        {contextMenu && (
          <div
            ref={contextMenuRef}
            className={styles.contextMenu}
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            {!showHexPicker ? (
              <>
                {/* ── 색상 칩 행: [현재색] [미사용×7] [>] ── */}
                <div className={styles.colorChipRow}>
                  {suggestedColors.map((color, idx) => {
                    const isCurrentColor = idx === 0; // 슬롯 0 = 현재 캘린더 색
                    return (
                      <button
                        key={idx}
                        className={`${styles.colorChip} ${isCurrentColor ? styles.colorChipCurrent : ''}`}
                        style={{ backgroundColor: color }}
                        onClick={(e) => { e.stopPropagation(); handleChipColorSelect(color, idx); }}
                        title={isCurrentColor ? '현재 색상 (클릭하면 색상환 열림)' : color}
                      />
                    );
                  })}
                  {/* > 버튼 - 색상환(HexPicker) 열기 */}
                  <button
                    className={styles.colorChipMore}
                    onClick={(e) => { e.stopPropagation(); setShowHexPicker(true); }}
                    title="색상환에서 선택"
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>chevron_right</span>
                  </button>
                </div>

                {/* 구독 설정 */}
                {(() => {
                  const cal = calendars.find(c => c.url === contextMenu.calendarUrl);
                  const isSub = cal?.type === 'subscription' || cal?.isSubscription || cal?.url.endsWith('.ics') || cal?.url.includes('holidays');
                  if (isSub) {
                    return (
                      <button
                        className={styles.contextMenuItem}
                        onClick={() => {
                          setSubscriptionSettingsCalUrl(contextMenu.calendarUrl);
                          setContextMenu(null);
                        }}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>settings</span>
                        <span>구독 설정</span>
                      </button>
                    );
                  }
                  return null;
                })()}

                <div className={styles.contextMenuDivider} />

                {/* 맥 캘린더에 추가 */}
                {(() => {
                  const cal = calendars.find(c => c.url === contextMenu.calendarUrl);
                  const isLocalOnly = cal?.isLocal && !cal?.isSubscription && cal?.type !== 'caldav';
                  if (isLocalOnly && onSyncToMac) {
                    return (
                      <button
                        className={styles.contextMenuItem}
                        onClick={() => {
                          onSyncToMac(cal);
                          setContextMenu(null);
                        }}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>upload</span>
                        <span>맥 캘린더에 추가</span>
                      </button>
                    );
                  }
                  return null;
                })()}

                <button className={`${styles.contextMenuItem} ${styles.contextMenuItemDelete}`} onClick={handleDelete}>
                  <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>delete</span>
                  <span>
                    {(() => {
                      const cal = calendars.find(c => c.url === contextMenu.calendarUrl);
                      if (cal?.isLocal) return '삭제';
                      if (cal?.readOnly || cal?.isSubscription) return '구독 취소';
                      return '삭제';
                    })()}
                  </span>
                </button>
              </>
            ) : (
              /* 색상환 선택 (HexColorPicker) */
              <div style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowHexPicker(false); }}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280', padding: 0, display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>chevron_left</span>
                  </button>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>색상 선택</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowHexPicker(false); setContextMenu(null); }}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280', padding: 0, display: 'flex' }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>close</span>
                  </button>
                </div>
                <HexColorPicker
                  color={currentCalColor}
                  onChange={handleHexColorChange}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Subscription Settings Popup */}
      {subscriptionSettingsCalUrl && createPortal((() => {
        const cal = calendars.find(c => c.url === subscriptionSettingsCalUrl);
        if (!cal) return null;
        const subscriptionUrl = cal.subscriptionUrl || cal.url;
        return (
          <div id="subscription-settings-popup" className={styles.subscriptionSettingsOverlay} onClick={() => setSubscriptionSettingsCalUrl(null)}>
            <div className={styles.subscriptionSettingsPopup} onClick={e => e.stopPropagation()}>
              <div className={styles.subscriptionSettingsHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: cal.color, flexShrink: 0 }} />
                  <span className={styles.subscriptionSettingsTitle}>{cal.displayName}</span>
                </div>
                <button
                  className={styles.subscriptionSettingsClose}
                  onClick={() => setSubscriptionSettingsCalUrl(null)}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>close</span>
                </button>
              </div>
              <label className={styles.subscriptionSettingsLabel}>구독 URL</label>
              <div className={styles.subscriptionUrlRow}>
                <input
                  className={styles.subscriptionUrlInput}
                  value={subscriptionUrl}
                  readOnly
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
                <button
                  className={styles.subscriptionCopyButton}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(subscriptionUrl);
                      onShowToast?.('URL이 클립보드에 복사되었습니다.', 'success');
                    } catch {
                      onShowToast?.('복사에 실패했습니다.', 'error');
                    }
                  }}
                  title="URL 복사"
                >
                  <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>content_copy</span>
                </button>
              </div>
            </div>
          </div>
        );
      })(), document.body)}
    </>
  );
}

export const CalendarListPopup = memo(CalendarListPopupComponent);

