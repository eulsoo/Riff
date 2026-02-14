import { Routine } from '../types';
import styles from './RoutineIcon.module.css';

interface RoutineIconProps {
  routine: Routine;
  completed: boolean;
  enabled: boolean;
  onClick: () => void;
}

// 호환성을 위한 Lucide -> Material Icon 매핑
const LEGACY_ICON_MAP: Record<string, string> = {
  'NotebookPen': 'edit_note',
  'Dumbbell': 'fitness_center',
  'Coffee': 'coffee',
  'Book': 'menu_book',
  'Music': 'music_note',
  'Heart': 'favorite',
  'Pill': 'medication',
  'Utensils': 'restaurant',
  'Moon': 'dark_mode',
  'Sun': 'light_mode',
  'Droplet': 'water_drop',
  'Apple': 'nutrition',
  'GraduationCap': 'school',
  'Briefcase': 'work',
  'Home': 'home',
  'Users': 'group',
  'Phone': 'call',
  'Mail': 'mail',
  'Camera': 'photo_camera',
  'Palette': 'palette',
  'Bike': 'directions_bike',
  'Plane': 'flight',
  'TreePine': 'forest',
  'Sparkles': 'auto_awesome',
  'Zap': 'bolt',
  'Circle': 'circle'
};

export function RoutineIcon({ routine, completed, enabled, onClick }: RoutineIconProps) {
  // 아이콘 이름 해석: 매핑에 있으면 변환, 없으면 그대로 사용 (새로운 Material Symbols)
  const iconName = LEGACY_ICON_MAP[routine.icon] || routine.icon;

  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      className={`${styles.routineIcon} ${completed ? styles.routineIconCompleted : styles.routineIconIncomplete
        }`}
      style={{
        backgroundColor: 'transparent',
        color: completed ? routine.color : '#d1d5db',
      }}
      title={routine.name}
    >
      <span
        className={`material-symbols-rounded ${styles.routineIconIcon}`}
        style={{
          fontSize: '20px',
          fontWeight: 500,
          fontVariationSettings: `'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24`
        }}
      >
        {iconName}
      </span>
    </button>
  );
}
