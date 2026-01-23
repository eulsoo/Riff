import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { Routine } from '../App';
import * as Icons from 'lucide-react';
import styles from './RoutineModal.module.css';

interface RoutineModalProps {
  routines: Routine[];
  onClose: () => void;
  onAdd: (routine: Omit<Routine, 'id'>) => void;
  onDelete: (routineId: string) => void;
}

const AVAILABLE_ICONS = [
  'Dumbbell',
  'Coffee',
  'Book',
  'Music',
  'Heart',
  'Pill',
  'Utensils',
  'Moon',
  'Sun',
  'Droplet',
  'Apple',
  'GraduationCap',
  'NotebookPen',
  'Briefcase',
  'Home',
  'Users',
  'Phone',
  'Mail',
  'Camera',
  'Palette',
  'Bike',
  'Plane',
  'TreePine',
  'Sparkles',
  'Zap',
];

const COLORS = [
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
];

const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];

export function RoutineModal({ routines, onClose, onAdd, onDelete }: RoutineModalProps) {
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState(AVAILABLE_ICONS[0]);
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [iconSearch, setIconSearch] = useState('');

  const handleAddRoutine = () => {
    if (name.trim() && selectedDays.length > 0) {
      onAdd({
        name: name.trim(),
        icon: selectedIcon,
        color: selectedColor,
        days: selectedDays,
      });
      setName('');
      setSelectedDays([]);
    }
  };

  const toggleDay = (day: number) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter(d => d !== day));
    } else {
      setSelectedDays([...selectedDays, day].sort());
    }
  };

  const filteredIcons = AVAILABLE_ICONS.filter(icon =>
    icon.toLowerCase().includes(iconSearch.toLowerCase())
  );

  const IconComponent = (Icons[selectedIcon as keyof typeof Icons] as any) || Icons.Circle;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBackdrop} onClick={onClose} />

      <div className={styles.modal}>
        {/* 헤더 */}
        <div className={styles.modalHeader}>
          <h2 className={styles.modalHeaderTitle}>루틴 관리</h2>
          <button
            onClick={onClose}
            className={styles.modalCloseButton}
          >
            <X className={styles.modalCloseIcon} />
          </button>
        </div>

        <div className={styles.modalContent}>
          {/* 기존 루틴 목록 */}
          <div className={styles.routinesSection}>
            <h3 className={styles.routinesSectionTitle}>등록된 루틴</h3>
            <div className={styles.routinesList}>
              {routines.length === 0 ? (
                <p className={styles.routinesEmpty}>
                  등록된 루틴이 없습니다.
                </p>
              ) : (
                routines.map(routine => {
                  const Icon = (Icons[routine.icon as keyof typeof Icons] as any) || Icons.Circle;
                  return (
                    <div
                      key={routine.id}
                      className={styles.routineItem}
                    >
                      <div className={styles.routineItemLeft}>
                        <div
                          className={styles.routineIcon}
                          style={{ backgroundColor: routine.color }}
                        >
                          <Icon className={styles.routineIconSvg} strokeWidth={2.5} />
                        </div>
                        <div className={styles.routineInfo}>
                          <div className={styles.routineName}>{routine.name}</div>
                          <div className={styles.routineDays}>
                            {routine.days.map(d => DAY_NAMES[d]).join(', ')}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => onDelete(routine.id)}
                        className={styles.routineDeleteButton}
                      >
                        <Trash2 className={styles.routineDeleteIcon} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 새 루틴 추가 */}
          <div className={styles.addRoutineSection}>
            <h3 className={styles.addRoutineSectionTitle}>새 루틴 추가</h3>

            <div className={styles.addRoutineForm}>
              {/* 루틴 이름 */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  루틴 이름
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="예: 운동, 독서, 물 마시기"
                  className={styles.formInput}
                />
              </div>

              {/* 아이콘 선택 */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  아이콘 선택
                </label>
                <input
                  type="text"
                  value={iconSearch}
                  onChange={e => setIconSearch(e.target.value)}
                  placeholder="아이콘 검색..."
                  className={styles.formInputSmall}
                />
                <div className={styles.iconGrid}>
                  {filteredIcons.map(icon => {
                    const Icon = (Icons[icon as keyof typeof Icons] as any) || Icons.Circle;
                    return (
                      <button
                        key={icon}
                        type="button"
                        onClick={() => setSelectedIcon(icon)}
                        className={`${styles.iconButton} ${
                          selectedIcon === icon
                            ? styles.iconButtonSelected
                            : styles.iconButtonUnselected
                        }`}
                        title={icon}
                      >
                        <Icon className={styles.iconButtonSvg} strokeWidth={2.5} />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 색상 선택 */}
              <div className={styles.formGroup}>
                <label className={styles.formLabelLarge}>색상</label>
                <div className={styles.colorPicker}>
                  {COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      className={`${styles.colorButton} ${selectedColor === color ? styles.colorButtonSelected : ''}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* 요일 선택 */}
              <div className={styles.formGroup}>
                <label className={styles.formLabelLarge}>
                  반복 요일
                </label>
                <div className={styles.dayButtons}>
                  {DAY_NAMES.map((day, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => toggleDay(index)}
                      className={`${styles.dayButton} ${
                        selectedDays.includes(index)
                          ? styles.dayButtonSelected
                          : styles.dayButtonUnselected
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              {/* 미리보기 */}
              <div className={styles.preview}>
                <div
                  className={styles.previewIcon}
                  style={{ backgroundColor: selectedColor }}
                >
                  <IconComponent className={styles.previewIconSvg} strokeWidth={2.5} />
                </div>
                <div className={styles.previewInfo}>
                  <div className={styles.previewLabel}>미리보기</div>
                  <div className={styles.previewName}>
                    {name || '루틴 이름을 입력하세요'}
                  </div>
                </div>
              </div>

              {/* 추가 버튼 */}
              <button
                onClick={handleAddRoutine}
                disabled={!name.trim() || selectedDays.length === 0}
                className={styles.addButton}
              >
                <Plus className={styles.addButtonIcon} />
                루틴 추가
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
