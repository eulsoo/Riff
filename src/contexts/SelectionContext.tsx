import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

interface SelectionContextType {
  selectedEventIds: string[];
  toggleSelection: (id: string, multi: boolean) => void;
  clearSelection: () => void;
  setSelectedIds: (ids: string[]) => void;
  removeIdFromSelection: (id: string) => void;
  selectedIdsSet: Set<string>; // 빠른 조회를 위한 Set
}

const SelectionContext = createContext<SelectionContextType | undefined>(undefined);

export const SelectionProvider = ({ children }: { children: ReactNode }) => {
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);

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


  const value = useMemo(() => ({
    selectedEventIds,
    toggleSelection,
    clearSelection,
    setSelectedIds,
    removeIdFromSelection,
    selectedIdsSet: new Set(selectedEventIds)
  }), [selectedEventIds, toggleSelection, clearSelection, setSelectedIds, removeIdFromSelection]);

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
};

export const useSelection = () => {
  const context = useContext(SelectionContext);
  if (context === undefined) {
    throw new Error('useSelection must be used within a SelectionProvider');
  }
  return context;
};
