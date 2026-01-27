import { Routine } from '../types';
import * as Icons from 'lucide-react';
import { LucideIcon } from 'lucide-react';
import styles from './RoutineIcon.module.css';

interface RoutineIconProps {
  routine: Routine;
  completed: boolean;
  enabled: boolean;
  onClick: () => void;
}

export function RoutineIcon({ routine, completed, enabled, onClick }: RoutineIconProps) {
  const IconComponent = (Icons[routine.icon as keyof typeof Icons] as LucideIcon) || Icons.Circle;

  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      className={`${styles.routineIcon} ${completed ? styles.routineIconCompleted : styles.routineIconIncomplete
        }`}
      style={{
        backgroundColor: completed ? routine.color : '#e5e7eb',
        color: completed ? 'white' : '#9ca3af',
      }}
      title={routine.name}
    >
      <IconComponent className={styles.routineIconIcon} strokeWidth={2.5} />
    </button>
  );
}
