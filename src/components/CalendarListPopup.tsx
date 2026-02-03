import { useState, useRef, useEffect, useMemo, memo } from 'react';

import { HexColorPicker } from 'react-colorful';
import { CalendarMetadata } from '../services/api';
import styles from './CalendarListPopup.module.css';

export interface CalendarListPopupProps {
  calendars: CalendarMetadata[];
  visibleUrlSet: Set<string>;
  onToggle: (url: string) => void;
  onClose: () => void;
  onAddLocalCalendar?: (name: string, color: string) => string; // returns url
  onUpdateLocalCalendar?: (url: string, updates: Partial<CalendarMetadata>) => void;
  onDeleteCalendar?: (url: string) => void;
  onSyncToMac?: (calendar: CalendarMetadata) => void; // Sync local calendar to Mac/iCloud
}

const PRESET_COLORS = [
  '#ff3b30', // Red
  '#ff9500', // Orange
  '#ffcc00', // Yellow
  '#4cd964', // Green
  '#007aff', // Blue
  '#5856d6', // Purple
  '#a2845e', // Brown
];

// 캘린더 아이템 렌더링 함수 (컴포넌트가 아닌 함수로 정의하여 리렌더링 방지)
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
  const isVisible = visibleUrlSet.has(cal.url);
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

      {/* Share Status Indicator */}
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
}: CalendarListPopupProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; calendarUrl: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null); // For highlighting
  const [showColorPicker, setShowColorPicker] = useState(false);

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
        setShowColorPicker(false); // Reset picker state on close
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select(); // 전체 텍스트 선택
    }
  }, [editingId]);

  const handleContextMenu = (e: React.MouseEvent, cal: CalendarMetadata) => {
    e.preventDefault();
    setSelectedId(cal.url);
    setContextMenu({ x: e.clientX, y: e.clientY, calendarUrl: cal.url });
    setShowColorPicker(false);
  };

  const handleAddClick = () => {
    // 새 캘린더 추가 후 바로 수정 모드 진입
    if (onAddLocalCalendar) {
      const newUrl = onAddLocalCalendar('무제', '#ff3b30'); // 기본값
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
    if (e.key === 'Enter') {
      handleNameSave();
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  const handleDelete = () => {
    if (contextMenu && onDeleteCalendar) {
      onDeleteCalendar(contextMenu.calendarUrl);
      setContextMenu(null);
    }
  };

  const handleColorChange = (color: string) => {
    if (contextMenu && onUpdateLocalCalendar) {
      onUpdateLocalCalendar(contextMenu.calendarUrl, { color });
      // Don't close immediately if using picker, let user slide
      if (!showColorPicker) {
        setContextMenu(null);
      }
    }
  };

  // Group calendars - memoized to prevent recalculation on every render
  const groups = useMemo(() => {
    const result = {
      riff: [] as CalendarMetadata[],        // 1. riff (Local + Sync To iCloud)
      riffFromIcloud: [] as CalendarMetadata[], // 2. riff <- icloud
      subscription: [] as CalendarMetadata[],     // 4. Subscription
    };

    calendars.forEach(cal => {
      // 0. System calendars filtering (inbox, outbox, notification)
      if (cal.url.includes('/inbox/') || cal.url.includes('/outbox/') || cal.url.includes('/notification/')) {
        return;
      }

      // 4. Subscription check
      if (cal.isSubscription || cal.type === 'subscription' || cal.url.endsWith('.ics') || cal.url.includes('holidays')) {
        result.subscription.push(cal);
        return;
      }

      // 1. riff (Local & App-created CalDAV)
      if (cal.isLocal || cal.createdFromApp) {
        result.riff.push(cal);
        return;
      }

      // 3. riff <- icloud (Remaining CalDAV)
      result.riffFromIcloud.push(cal);
    });

    return result;
  }, [calendars]);

  return (
    <>
      <div className={styles.popupContainer}>
        <div className={styles.header}>
          <h3 className={styles.title}>캘린더 목록</h3>
          <button onClick={onClose} className={styles.closeButton}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>close</span>
          </button>
        </div>

        {calendars.length === 0 ? (
          <div style={{ padding: '1rem 0', fontSize: '0.85rem', color: '#666', textAlign: 'center' }}>
            표시할 캘린더가 없습니다.
          </div>
        ) : (
          <div className={styles.calendarList}>
            {/* 1. riff (Local) */}
            {groups.riff.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Riff</span>
                  <span className={`material-symbols-rounded ${styles.actionIcon}`} style={{ fontSize: '16px' }}>add</span>
                </div>
                {groups.riff.map(cal => renderCalendarItem(
                  cal, true, visibleUrlSet, editingId, editingName, selectedId,
                  inputRef, onToggle, handleContextMenu, setSelectedId,
                  setEditingId, setEditingName, handleNameSave, handleKeyDown
                ))}
              </div>
            )}



            {/* 3. riff <- icloud */}
            {groups.riffFromIcloud.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {/* <span>riff</span>
                    <ArrowLeft size={12} /> */}
                    <span>iCloud</span>
                  </div>
                  <span className={`material-symbols-rounded ${styles.actionIcon}`} style={{ fontSize: '16px' }}>cloud_download</span>
                </div>
                {groups.riffFromIcloud.map(cal => renderCalendarItem(
                  cal, false, visibleUrlSet, editingId, editingName, selectedId,
                  inputRef, onToggle, handleContextMenu, setSelectedId,
                  setEditingId, setEditingName, handleNameSave, handleKeyDown
                ))}
              </div>
            )}

            {/* 4. Subscription */}
            {groups.subscription.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>구독</span>
                  <span className={`material-symbols-rounded ${styles.actionIcon}`} style={{ fontSize: '16px' }}>cloud_download</span>
                </div>
                {groups.subscription.map(cal => renderCalendarItem(
                  cal, false, visibleUrlSet, editingId, editingName, selectedId,
                  inputRef, onToggle, handleContextMenu, setSelectedId,
                  setEditingId, setEditingName, handleNameSave, handleKeyDown
                ))}
              </div>
            )}
          </div>
        )}

        <button className={styles.addButton} onClick={handleAddClick}>
          <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>add</span>
          <span>캘린더 추가</span>
        </button>
      </div >

      {/* Context Menu */}
      {
        contextMenu && (
          <div
            ref={contextMenuRef}
            className={styles.contextMenu}
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            {!showColorPicker ? (
              <>
                <div className={styles.colorGrid}>
                  {PRESET_COLORS.map(color => (
                    <div
                      key={color}
                      className={styles.colorOption}
                      style={{ backgroundColor: color }}
                      onClick={() => handleColorChange(color)}
                    />
                  ))}
                </div>

                <div
                  className={styles.contextMenuItem}
                  style={{ marginBottom: '0.25rem', cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowColorPicker(true);
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>palette</span>
                  <span>사용자 색상 설정...</span>
                </div>

                <div className={styles.contextMenuDivider} />

                {/* 맥 캘린더에 추가 - 로컬 캘린더만 표시 (구독/CalDAV 제외) */}
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

                <button className={`${styles.contextMenuItem} delete`} onClick={handleDelete}>
                  <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>delete</span>
                  <span>
                    {(() => {
                      const cal = calendars.find(c => c.url === contextMenu.calendarUrl);
                      // 읽기 전용이거나 구독 전용인 경우만 '구독 취소'
                      // 내 캘린더(CalDAV 포함)는 '삭제'
                      if (cal?.isLocal) return '삭제';
                      if (cal?.readOnly || cal?.isSubscription) return '구독 취소';
                      return '삭제';
                    })()}
                  </span>
                </button>
              </>
            ) : (
              <div style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>색상 선택</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowColorPicker(false); }}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280', padding: 0, display: 'flex' }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>close</span>
                  </button>
                </div>
                <HexColorPicker
                  color={calendars.find(c => c.url === contextMenu.calendarUrl)?.color || '#3b82f6'}
                  onChange={handleColorChange}
                />
              </div>
            )}
          </div>
        )
      }
    </>
  );
}

// Wrap with memo to prevent re-renders when parent updates
export const CalendarListPopup = memo(CalendarListPopupComponent);

export function CalendarToggleButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className={styles.toggleButton} aria-label="캘린더 목록">
      <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>calendar_month</span>
    </button>
  );
}
