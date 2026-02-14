import { useState } from 'react';
import { Routine } from '../types';
import shared from './SharedModal.module.css';
import styles from './RoutineModal.module.css';

interface RoutineModalProps {
  routines: Routine[];
  onClose: () => void;
  onAdd: (routine: Omit<Routine, 'id'>) => void;
  onDelete: (routineId: string) => void;
  onUpdate: (routineId: string, updates: Partial<Omit<Routine, 'id'>>) => void;
}

const AVAILABLE_ICONS = [
  'fitness_center', 'coffee', 'menu_book', 'music_note',
  'favorite', 'medication', 'restaurant', 'dark_mode',
  'light_mode', 'water_drop', 'nutrition', 'school',
  'edit_note', 'work', 'home', 'group',
  'call', 'mail', 'photo_camera', 'palette',
  'directions_bike', 'flight', 'forest', 'auto_awesome', 'bolt',
];

const COLORS = [
  '#ef4444', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];

// Legacy icon mapping
const LEGACY_ICON_MAP: Record<string, string> = {
  'NotebookPen': 'edit_note', 'Dumbbell': 'fitness_center',
  'Coffee': 'coffee', 'Book': 'menu_book', 'Music': 'music_note',
  'Heart': 'favorite', 'Pill': 'medication', 'Utensils': 'restaurant',
  'Moon': 'dark_mode', 'Sun': 'light_mode', 'Droplet': 'water_drop',
  'Apple': 'nutrition', 'GraduationCap': 'school', 'Briefcase': 'work',
  'Home': 'home', 'Users': 'group', 'Phone': 'call', 'Mail': 'mail',
  'Camera': 'photo_camera', 'Palette': 'palette', 'Bike': 'directions_bike',
  'Plane': 'flight', 'TreePine': 'forest', 'Sparkles': 'auto_awesome',
  'Zap': 'bolt', 'Circle': 'circle'
};

export function RoutineModal({ routines, onClose, onAdd, onDelete, onUpdate }: RoutineModalProps) {
  const [step, setStep] = useState<'list' | 'create' | 'edit'>('list');
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState(AVAILABLE_ICONS[0]);
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const handleAddRoutine = () => {
    if (name.trim() && selectedDays.length > 0) {
      onAdd({
        name: name.trim(),
        icon: selectedIcon,
        color: selectedColor,
        days: selectedDays,
      });
      resetForm();
      setStep('list');
    }
  };

  const handleUpdateRoutine = () => {
    if (editingRoutineId && name.trim() && selectedDays.length > 0) {
      onUpdate(editingRoutineId, {
        name: name.trim(),
        icon: selectedIcon,
        color: selectedColor,
        days: selectedDays,
      });
      resetForm();
      setStep('list');
    }
  };

  const resetForm = () => {
    setName('');
    setSelectedDays([]);
    setSelectedIcon(AVAILABLE_ICONS[0]);
    setSelectedColor(COLORS[0]);
    setShowColorPicker(false);
    setEditingRoutineId(null);
  };

  const toggleDay = (day: number) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    );
  };

  const goToCreate = () => {
    resetForm();
    setStep('create');
  };

  const goToEdit = (routine: Routine) => {
    const iconName = LEGACY_ICON_MAP[routine.icon] || routine.icon;
    setEditingRoutineId(routine.id);
    setName(routine.name);
    setSelectedIcon(iconName);
    setSelectedColor(routine.color);
    setSelectedDays([...routine.days]);
    setShowColorPicker(false);
    setStep('edit');
  };

  const isFormStep = step === 'create' || step === 'edit';

  return (
    <div className={shared.modalOverlay}>
      <div className={shared.modalBackdrop} onClick={onClose} />

      <div className={shared.modal}>
        {/* Header */}
        <div className={shared.modalHeader}>
          <div className={shared.modalHeaderSpacer}>
            {isFormStep && (
              <button onClick={() => { resetForm(); setStep('list'); }} className={shared.backButton} aria-label="뒤로">
                <span className={`material-symbols-rounded ${shared.backIcon}`}>arrow_back_ios</span>
              </button>
            )}
          </div>
          <div className={shared.modalTitle}>
            {step === 'list' ? '루틴 관리' : step === 'create' ? '새 루틴' : '루틴 수정'}
          </div>
          <div className={shared.modalHeaderSpacerEnd}>
            <button onClick={onClose} className={shared.modalCloseButton}>
              <span className={`material-symbols-rounded ${shared.modalCloseIcon}`}>close</span>
            </button>
          </div>
        </div>

        <div className={shared.modalContent}>
          {step === 'list' ? (
            /* ===== Step 1: Routine List ===== */
            <div>
              <div className={shared.formLabel}>등록된 루틴</div>
              <div className={styles.routinesList}>
                {routines.length === 0 ? (
                  <div className={shared.emptyState}>
                    등록된 루틴이 없습니다.
                  </div>
                ) : (
                  routines.map(routine => {
                    const iconName = LEGACY_ICON_MAP[routine.icon] || routine.icon;
                    return (
                      <div key={routine.id} className={styles.routineItem}>
                        <div className={styles.routineItemLeft}>
                          <span
                            className={`material-symbols-rounded ${styles.routineIconDisplay}`}
                            style={{
                              color: routine.color,
                              fontVariationSettings: `'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24`
                            }}
                          >
                            {iconName}
                          </span>
                          <div className={styles.routineInfo}>
                            <div className={styles.routineName}>{routine.name}</div>
                            <div className={styles.routineDays}>
                              {routine.days.map(d => DAY_NAMES[d]).join(', ')}
                            </div>
                          </div>
                        </div>
                        <div className={styles.routineActions}>
                          <button
                            onClick={() => goToEdit(routine)}
                            className={styles.routineActionButton}
                          >
                            <span className={`material-symbols-rounded ${styles.routineActionIcon}`}>edit</span>
                          </button>
                          <button
                            onClick={() => onDelete(routine.id)}
                            className={styles.routineActionButton}
                          >
                            <span className={`material-symbols-rounded ${styles.routineDeleteIcon}`}>delete</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Create New Button */}
              <button onClick={goToCreate} className={`${shared.accentButton} ${styles.createButton}`}>
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
                새로 만들기
              </button>
            </div>
          ) : (
            /* ===== Step 2/3: Create or Edit Routine ===== */
            <div className={styles.createForm}>
              {/* Name + Color Chip */}
              <div className={shared.formGroup}>
                <label className={shared.formLabel}>루틴 이름</label>
                <div className={styles.nameInputWrapper}>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="예: 운동, 독서, 물 마시기"
                    className={`${shared.formInput} ${styles.nameInput}`}
                  />
                  <div className={styles.colorChipContainer}>
                    <button
                      type="button"
                      className={styles.colorChip}
                      style={{ backgroundColor: selectedColor }}
                      onClick={() => setShowColorPicker(!showColorPicker)}
                      aria-label="색상 선택"
                    />
                    <span
                      className={`material-symbols-rounded ${styles.colorChipArrow}`}
                      onClick={() => setShowColorPicker(!showColorPicker)}
                    >
                      expand_more
                    </span>
                    {showColorPicker && (
                      <div className={styles.colorDropdown}>
                        {COLORS.map(color => (
                          <button
                            key={color}
                            type="button"
                            className={`${styles.colorDropdownItem} ${selectedColor === color ? styles.colorDropdownItemSelected : ''}`}
                            style={{ backgroundColor: color }}
                            onClick={() => {
                              setSelectedColor(color);
                              setShowColorPicker(false);
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Icon Selection */}
              <div className={shared.formGroup}>
                <label className={shared.formLabel}>아이콘</label>
                <div className={styles.iconGrid}>
                  {AVAILABLE_ICONS.map(icon => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setSelectedIcon(icon)}
                      className={`${styles.iconButton} ${selectedIcon === icon ? styles.iconButtonSelected : styles.iconButtonUnselected
                        }`}
                      title={icon}
                    >
                      <span
                        className="material-symbols-rounded"
                        style={{
                          fontSize: '20px',
                          fontVariationSettings: `'FILL' ${selectedIcon === icon ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`
                        }}
                      >
                        {icon}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Day Selection */}
              <div className={shared.formGroup}>
                <label className={shared.formLabel}>반복 요일</label>
                <div className={styles.dayButtons}>
                  {DAY_NAMES.map((day, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => toggleDay(index)}
                      className={`${styles.dayButton} ${selectedDays.includes(index) ? styles.dayButtonSelected : styles.dayButtonUnselected
                        }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit Button */}
              <button
                onClick={step === 'edit' ? handleUpdateRoutine : handleAddRoutine}
                disabled={!name.trim() || selectedDays.length === 0}
                className={shared.accentButton}
              >
                {step === 'edit' ? '확인' : '루틴 추가'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
