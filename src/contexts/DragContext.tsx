import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { Event } from '../types';

interface DragState {
  draggingEvent: Event;
  originDate: string;
  durationDays: number;
}

interface DragContextType {
  dragState: DragState | null;
  dragOverDate: string | null;
  startDrag: (event: Event, originDate: string, isReadOnly?: boolean) => void;
  setDragOverDate: (date: string | null) => void;
  endDrag: (onUpdate: (eventId: string, updates: Partial<Event>) => void) => void;
  cancelDrag: () => void;
  ghostRef: React.MutableRefObject<HTMLDivElement | null>;
  // 동기적으로 최신 dragState/dragOverDate를 읽기 위한 refs
  dragStateRef: React.MutableRefObject<DragState | null>;
  dragOverDateRef: React.MutableRefObject<string | null>;
  // 구독 이벤트 드래그 시도 시 호출될 콜백 (MainLayout에서 설정)
  onBlockedDragRef: React.MutableRefObject<(() => void) | null>;
}

const DragContext = createContext<DragContextType | undefined>(undefined);

export const dateDiffDays = (from: string, to: string): number => {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
};

export const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const DragProvider = ({ children }: { children: ReactNode }) => {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOverDate, setDragOverDateState] = useState<string | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);

  // refs: 항상 최신 값을 동기적으로 읽을 수 있음 (stale closure 방지)
  const dragStateRef = useRef<DragState | null>(null);
  const dragOverDateRef = useRef<string | null>(null);
  const onBlockedDragRef = useRef<(() => void) | null>(null);

  const startDrag = useCallback((event: Event, originDate: string, isReadOnly?: boolean) => {
    // 구독/읽기전용 이벤트 드래그 차단
    if (isReadOnly) {
      onBlockedDragRef.current?.();
      return;
    }
    const startDate = event.date;
    const endDate = event.endDate || event.date;
    const durationDays = dateDiffDays(startDate, endDate);
    const state = { draggingEvent: event, originDate, durationDays };
    dragStateRef.current = state;
    dragOverDateRef.current = null;
    setDragState(state);
    setDragOverDateState(null);
  }, []);

  const setDragOverDate = useCallback((date: string | null) => {
    dragOverDateRef.current = date;
    setDragOverDateState(date);
  }, []);

  const endDrag = useCallback((
    onUpdate: (eventId: string, updates: Partial<Event>) => void
  ) => {
    // refs에서 최신 값을 동기적으로 읽음
    const state = dragStateRef.current;
    const targetDate = dragOverDateRef.current;

    if (state && targetDate && targetDate !== state.originDate) {
      const newEndDate = state.durationDays > 0
        ? addDays(targetDate, state.durationDays)
        : targetDate;
      onUpdate(state.draggingEvent.id, { date: targetDate, endDate: newEndDate });
    }

    // cleanup
    if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }
    dragStateRef.current = null;
    dragOverDateRef.current = null;
    setDragState(null);
    setDragOverDateState(null);
  }, []); // 의존성 없음 - 항상 ref에서 읽으므로

  const cancelDrag = useCallback(() => {
    if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }
    dragStateRef.current = null;
    dragOverDateRef.current = null;
    setDragState(null);
    setDragOverDateState(null);
  }, []);

  return (
    <DragContext.Provider value={{
      dragState,
      dragOverDate,
      startDrag,
      setDragOverDate,
      endDrag,
      cancelDrag,
      ghostRef,
      dragStateRef,
      dragOverDateRef,
      onBlockedDragRef,
    }}>
      {children}
    </DragContext.Provider>
  );
};

export const useDrag = () => {
  const ctx = useContext(DragContext);
  if (!ctx) throw new Error('useDrag must be used within DragProvider');
  return ctx;
};
