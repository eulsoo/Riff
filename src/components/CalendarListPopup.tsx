import { useState, useRef, useEffect } from 'react';
import { X, CalendarDays, Plus, Trash2, Palette } from 'lucide-react';
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

export function CalendarListPopup({
  calendars,
  visibleUrlSet,
  onToggle,
  onClose,
  onAddLocalCalendar,
  onUpdateLocalCalendar,
  onDeleteCalendar,
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

  // Group calendars
  const groups = {
    main: [] as CalendarMetadata[], // 로컬 + 공유됨 (타이틀 없음)
    subscription: [] as CalendarMetadata[], // 구독 (타이틀: 구독)
  };

  calendars.forEach(cal => {
    // 0. System calendars filtering (inbox, outbox, notification)
    if (cal.url.includes('/inbox/') || cal.url.includes('/outbox/') || cal.url.includes('/notification/')) {
      return;
    }

    // 1. Subscription check
    if (cal.isSubscription || cal.type === 'subscription' || cal.url.endsWith('.ics') || cal.url.includes('holidays')) {
      groups.subscription.push(cal);
      return;
    }

    // 2. All other calendars go to main group
    groups.main.push(cal);
  });

  const Section = ({ title, items, isLocalSection = false }: { title?: string, items: CalendarMetadata[], isLocalSection?: boolean }) => {
    if (items.length === 0) return null;
    return (
      <div className={styles.section}>
        {title && <div className={styles.sectionTitle}>{title}</div>}
        {items.map(cal => {
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
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className={styles.popupContainer}>
        <div className={styles.header}>
          <h3 className={styles.title}>캘린더 목록</h3>
          <button onClick={onClose} className={styles.closeButton}>
            <X size={18} />
          </button>
        </div>

        {calendars.length === 0 ? (
          <div style={{ padding: '1rem 0', fontSize: '0.85rem', color: '#666', textAlign: 'center' }}>
            표시할 캘린더가 없습니다.
          </div>
        ) : (
          <div className={styles.calendarList}>
            {/* 메인 그룹 (로컬 + 공유됨) - 타이틀 없음 */}
            <Section items={groups.main} isLocalSection={true} />

            {/* 구독 그룹 - 타이틀 있음 */}
            <Section title="구독" items={groups.subscription} />
          </div>
        )}

        <button className={styles.addButton} onClick={handleAddClick}>
          <Plus size={16} />
          <span>캘린더 추가</span>
        </button>
      </div>

      {/* Context Menu */}
      {contextMenu && (
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
                <Palette size={14} />
                <span>사용자 색상 설정...</span>
              </div>

              <div className={styles.contextMenuDivider} />

              <button className={`${styles.contextMenuItem} delete`} onClick={handleDelete}>
                <Trash2 size={14} />
                <span>
                  {(calendars.find(c => c.url === contextMenu.calendarUrl)?.isLocal)
                    ? '삭제'
                    : '구독 취소'}
                </span>
              </button>
            </>
          ) : (
            <div style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>색상 선택</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowColorPicker(false); }}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280', padding: 0 }}
                >
                  <X size={16} />
                </button>
              </div>
              <HexColorPicker
                color={calendars.find(c => c.url === contextMenu.calendarUrl)?.color || '#3b82f6'}
                onChange={handleColorChange}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function CalendarToggleButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className={styles.toggleButton} aria-label="캘린더 목록">
      <CalendarDays size={20} strokeWidth={2} />
    </button>
  );
}
