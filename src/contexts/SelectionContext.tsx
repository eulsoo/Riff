import { createContext, useContext, useState, useCallback, useMemo, useRef, ReactNode } from 'react';
import { Event } from '../types';

// 메인 선택 컨텍스트 (자주 변경되지 않음)
interface SelectionContextType {
  selectedEventIds: string[];
  toggleSelection: (id: string, multi: boolean) => void;
  clearSelection: () => void;
  setSelectedIds: (ids: string[]) => void;
  removeIdFromSelection: (id: string) => void;
  selectedIdsSet: Set<string>;
  clipboardEvent: Event | null;
  setClipboardEvent: (event: Event | null) => void;
}

// 호버 컨텍스트 (자주 변경됨, 별도 분리)
interface HoverContextType {
  hoveredDate: string | null;
  setHoveredDate: (date: string | null) => void;
}

const SelectionContext = createContext<SelectionContextType | undefined>(undefined);
const HoverContext = createContext<HoverContextType | undefined>(undefined);

export const SelectionProvider = ({ children }: { children: ReactNode }) => {
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [clipboardEvent, setClipboardEvent] = useState<Event | null>(null);

  const toggleSelection = useCallback((id: string, multi: boolean) => {
    setSelectedEventIds(prev => {
      if (multi) {
        return prev.includes(id)
          ? prev.filter(prevId => prevId !== id)
          : [...prev, id];
      }
      return [id];
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedEventIds([]);
  }, []);

  const setSelectedIds = useCallback((ids: string[]) => {
    setSelectedEventIds(ids);
  }, []);

  const removeIdFromSelection = useCallback((id: string) => {
    setSelectedEventIds(prev => prev.filter(prevId => prevId !== id));
  }, []);

  const selectedIdsSet = useMemo(() => new Set(selectedEventIds), [selectedEventIds]);

  const value = useMemo(() => ({
    selectedEventIds,
    toggleSelection,
    clearSelection,
    setSelectedIds,
    removeIdFromSelection,
    selectedIdsSet,
    clipboardEvent,
    setClipboardEvent,
  }), [selectedEventIds, toggleSelection, clearSelection, setSelectedIds, removeIdFromSelection, selectedIdsSet, clipboardEvent]);

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
};

// 호버 Provider를 별도로 분리 - 이 컨텍스트만 자주 업데이트됨
export const HoverProvider = ({ children }: { children: ReactNode }) => {
  // ref를 사용하여 실제 상태 업데이트 최소화
  const hoveredDateRef = useRef<string | null>(null);
  const [hoveredDate, setHoveredDateState] = useState<string | null>(null);

  const setHoveredDate = useCallback((date: string | null) => {
    // 동일한 값이면 업데이트 안 함
    if (hoveredDateRef.current === date) return;
    hoveredDateRef.current = date;
    setHoveredDateState(date);
  }, []);

  const value = useMemo(() => ({
    hoveredDate,
    setHoveredDate,
  }), [hoveredDate, setHoveredDate]);

  return (
    <HoverContext.Provider value={value}>
      {children}
    </HoverContext.Provider>
  );
};

export const useSelection = () => {
  const context = useContext(SelectionContext);
  if (context === undefined) {
    throw new Error('useSelection must be used within a SelectionProvider');
  }
  return context;
};

export const useHover = () => {
  const context = useContext(HoverContext);
  if (context === undefined) {
    throw new Error('useHover must be used within a HoverProvider');
  }
  return context;
};
