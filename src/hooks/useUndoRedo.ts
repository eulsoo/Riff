import { useState, useCallback, useEffect, useRef } from 'react';
import { Event } from '../types';

export type ActionType = 'CREATE' | 'UPDATE' | 'DELETE';

export interface HistoryAction {
  type: ActionType;
  event: Event; // For CREATE/UPDATE: the new state. For DELETE: the deleted event.
  prevEvent?: Event; // For UPDATE: the previous state.
}

export const useUndoRedo = () => {
  const [undoStack, setUndoStack] = useState<HistoryAction[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryAction[]>([]);

  // Refs for handlers to avoid circular dependencies
  const handlersRef = useRef<{
    onUndo: (action: HistoryAction) => Promise<void>;
    onRedo: (action: HistoryAction) => Promise<void>;
  }>({ onUndo: async () => {}, onRedo: async () => {} });

  const registerHandlers = useCallback((
    onUndo: (action: HistoryAction) => Promise<void>,
    onRedo: (action: HistoryAction) => Promise<void>
  ) => {
    handlersRef.current = { onUndo, onRedo };
  }, []);

  const recordAction = useCallback((action: HistoryAction) => {
    setUndoStack(prev => [...prev, action]);
    setRedoStack([]);
    console.log(`Action recorded: ${action.type}`, action.event.id);
  }, []);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    const action = undoStack[undoStack.length - 1];

    try {
      console.log('Undoing action:', action.type);
      await handlersRef.current.onUndo(action);
      
      setUndoStack(prev => prev.slice(0, prev.length - 1));
      setRedoStack(prev => [...prev, action]);
    } catch (e) {
      console.error('Undo execution failed:', e);
    }
  }, [undoStack]);

  const handleRedo = useCallback(async () => {
    if (redoStack.length === 0) return;
    const action = redoStack[redoStack.length - 1];

    try {
      console.log('Redoing action:', action.type);
      await handlersRef.current.onRedo(action);

      setRedoStack(prev => prev.slice(0, prev.length - 1));
      setUndoStack(prev => [...prev, action]);
    } catch (e) {
      console.error('Redo execution failed:', e);
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
    registerHandlers,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    handleUndo,
    handleRedo
  };
};
