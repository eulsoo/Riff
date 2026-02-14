import { useState, useCallback, useEffect, useRef } from 'react';
import { Event, Routine, Todo } from '../types';

export type ActionType = 'CREATE' | 'UPDATE' | 'DELETE' | 'TOGGLE';
export type ActionCategory = 'event' | 'routine' | 'todo';

export interface HistoryAction {
  category: ActionCategory;
  type: ActionType;

  // Event data
  event?: Event;
  prevEvent?: Event;

  // Routine data
  routine?: Routine;
  prevRoutine?: Routine;

  // Todo data
  todo?: Todo;
  prevTodo?: Todo;

  description?: string;
}

type CategoryHandler = {
  onUndo: (action: HistoryAction) => Promise<void>;
  onRedo: (action: HistoryAction) => Promise<void>;
};

const MAX_STACK_SIZE = 50;

export const useUndoRedo = () => {
  const [undoStack, setUndoStack] = useState<HistoryAction[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryAction[]>([]);

  // Per-category handlers to avoid overwrite issues
  const handlersRef = useRef<Record<string, CategoryHandler>>({});

  const registerCategoryHandlers = useCallback((
    category: ActionCategory,
    onUndo: (action: HistoryAction) => Promise<void>,
    onRedo: (action: HistoryAction) => Promise<void>
  ) => {
    handlersRef.current[category] = { onUndo, onRedo };
  }, []);

  const recordAction = useCallback((action: HistoryAction) => {
    setUndoStack(prev => [...prev.slice(-(MAX_STACK_SIZE - 1)), action]);
    setRedoStack([]);
    console.log(`[UndoRedo] Recorded: ${action.category}/${action.type}`, action.description ?? '');
  }, []);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    const action = undoStack[undoStack.length - 1];
    const handler = handlersRef.current[action.category];

    if (!handler) {
      console.warn(`[UndoRedo] No handler registered for category: ${action.category}`);
      return;
    }

    try {
      console.log('[UndoRedo] Undo:', action.category, action.type);
      await handler.onUndo(action);
      setUndoStack(prev => prev.slice(0, prev.length - 1));
      setRedoStack(prev => [...prev.slice(-(MAX_STACK_SIZE - 1)), action]);
    } catch (e) {
      console.error('[UndoRedo] Undo failed:', e);
    }
  }, [undoStack]);

  const handleRedo = useCallback(async () => {
    if (redoStack.length === 0) return;
    const action = redoStack[redoStack.length - 1];
    const handler = handlersRef.current[action.category];

    if (!handler) {
      console.warn(`[UndoRedo] No handler registered for category: ${action.category}`);
      return;
    }

    try {
      console.log('[UndoRedo] Redo:', action.category, action.type);
      await handler.onRedo(action);
      setRedoStack(prev => prev.slice(0, prev.length - 1));
      setUndoStack(prev => [...prev.slice(-(MAX_STACK_SIZE - 1)), action]);
    } catch (e) {
      console.error('[UndoRedo] Redo failed:', e);
    }
  }, [redoStack]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  return {
    recordAction,
    registerCategoryHandlers,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    handleUndo,
    handleRedo
  };
};
