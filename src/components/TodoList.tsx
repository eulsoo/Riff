import { useState, useRef, Fragment } from 'react';
import { Todo } from '../types';
import styles from './TodoList.module.css';
import { TodoCheckIcon } from './TodoCheckIcon';
import { MiniCalendar } from './MiniCalendar';

interface TodoListProps {
  todos: Todo[];
  onAdd: (text: string, deadline?: string) => void;
  onToggle: (todoId: string) => void;
  onUpdate: (todoId: string, text: string, deadline?: string) => void;
  onDelete: (todoId: string) => void;
  onReorder?: (newTodos: Todo[]) => void;
}

export function TodoList({
  todos,
  onAdd,
  onToggle,
  onUpdate,
  onDelete,
  onReorder,
}: TodoListProps) {
  // --- Todo States (Restored) ---
  const [isAdding, setIsAdding] = useState(false);
  const [newTodoText, setNewTodoText] = useState('');
  const [newDeadline, setNewDeadline] = useState<string | undefined>(undefined);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editDeadline, setEditDeadline] = useState<string | undefined>(undefined);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerPosition, setPickerPosition] = useState<'bottom' | 'top'>('bottom');

  // --- Drag & Drop States ---
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number, y: number } | null>(null);

  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const dragStartPos = useRef<{ x: number, y: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Refs for drag state to avoid stale closures in event listeners
  const dragIndexRef = useRef<number | null>(null);
  const dropTargetIndexRef = useRef<number | null>(null);
  const blockClickRef = useRef(false);

  // --- Drag Handlers ---
  const handleMouseDown = (e: React.MouseEvent, index: number) => {
    // Only left click, and not if editing
    if (e.button !== 0 || editingId) return;

    blockClickRef.current = false;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    longPressTimer.current = setTimeout(() => {
      // Long press triggered!
      setDragIndex(index);
      dragIndexRef.current = index;
      blockClickRef.current = true; // Block subsequent clicks

      setGhostPos({ x: e.clientX, y: e.clientY });

      // Add global listeners for drag/drop interaction
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }, 200); // 0.2s hold time
  };

  const clearDragState = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setDragIndex(null);
    setDropTargetIndex(null);
    setGhostPos(null);

    dragIndexRef.current = null;
    dropTargetIndexRef.current = null;
    dragStartPos.current = null;

    window.removeEventListener('mousemove', handleGlobalMouseMove);
    window.removeEventListener('mouseup', handleGlobalMouseUp);
  };

  const handleGlobalMouseMove = (e: MouseEvent) => {
    // Update ghost position
    setGhostPos({ x: e.clientX, y: e.clientY });

    // Find drop target (DropZone)
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    const dropZone = elements.find(el => el.closest('[data-drop-index]'));

    if (dropZone) {
      const zoneEl = dropZone.closest('[data-drop-index]') as HTMLElement;
      const indexStr = zoneEl.dataset.dropIndex;
      if (indexStr !== undefined) {
        const index = parseInt(indexStr, 10);
        setDropTargetIndex(index);
        dropTargetIndexRef.current = index;
      }
    } else {
      setDropTargetIndex(null);
      dropTargetIndexRef.current = null;
    }
  };

  const handleGlobalMouseUp = (e: MouseEvent) => {
    // Use REFS to get fresh state without relying on closures
    const sourceIndex = dragIndexRef.current;
    const targetIndex = dropTargetIndexRef.current;

    if (sourceIndex !== null && targetIndex !== null) {
      // If dropping on same item or immediate next (no change)
      if (targetIndex !== sourceIndex && targetIndex !== sourceIndex + 1) {
        const newTodos = [...todos];
        const [movedItem] = newTodos.splice(sourceIndex, 1);

        // Adjust target index based on removal
        // If source was before target, removing source shifts indices down by 1
        let finalTarget = targetIndex;
        if (sourceIndex < targetIndex) {
          finalTarget -= 1;
        }

        // Safety check
        if (finalTarget >= 0 && finalTarget <= newTodos.length) {
          newTodos.splice(finalTarget, 0, movedItem);

          if (onReorder) {
            onReorder(newTodos);
          }
        }
      }
    }

    clearDragState();
    // Delay unblocking click to prevent triggering handleEdit immediately after drop
    setTimeout(() => {
      blockClickRef.current = false;
    }, 100);
  };

  // Prevent text selection during long press attempt (optional but good)
  // ... can be done with CSS user-select: none on items

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Helper to format deadline as -Nd / +Nd
  const getDDay = (deadline: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(deadline);
    target.setHours(0, 0, 0, 0);
    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return '0d';
    if (diffDays > 0) return `-${diffDays}d`;
    return `+${Math.abs(diffDays)}d`;
  };

  const handleShowDatePicker = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (showDatePicker) {
      setShowDatePicker(false);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const CALENDAR_HEIGHT = 320; // Estimated height

    if (spaceBelow < CALENDAR_HEIGHT) {
      setPickerPosition('top');
    } else {
      setPickerPosition('bottom');
    }
    setShowDatePicker(true);
  };

  const handleAdd = () => {
    if (newTodoText.trim()) {
      onAdd(newTodoText.trim(), newDeadline);
      setNewTodoText('');
      setNewDeadline(undefined);
      setIsAdding(false);
      setShowDatePicker(false);
    }
  };

  const handleEdit = (todo: Todo) => {
    if (blockClickRef.current) return;
    // If already editing another, save or cancel? Let's cancel previous.
    setEditingId(todo.id);
    setEditText(todo.text);
    setEditDeadline(todo.deadline);
    setShowDatePicker(false); // Reset picker state
  };

  const handleSaveEdit = () => {
    if (editingId && editText.trim()) {
      onUpdate(editingId, editText.trim(), editDeadline);
      setEditingId(null);
      setEditText('');
      setEditDeadline(undefined);
      setShowDatePicker(false);
    }
  };

  const handleCancelEdit = () => {
    // If date picker is open, don't close edit mode on blur of input
    if (showDatePicker) return;

    setEditingId(null);
    setEditText('');
    setEditDeadline(undefined);
    setIsAdding(false);
    setNewTodoText('');
    setNewDeadline(undefined);
  };

  // Dedicated delete handler for edit mode
  const handleDeleteInEdit = (id: string, isNew: boolean) => {
    if (isNew) {
      setIsAdding(false);
      setNewTodoText('');
      setNewDeadline(undefined);
    } else {
      onDelete(id);
      setEditingId(null); // Exit edit mode
    }
    setShowDatePicker(false);
  };

  return (
    <div className={styles.todoList} ref={listRef}>
      {ghostPos && dragIndex !== null && (() => {
        const todo = todos[dragIndex];
        return (
          <div
            className={styles.dragGhostWrapper}
            style={{ left: ghostPos.x, top: ghostPos.y }}
          >
            <div
              className={`${styles.todoItemDisplay} ${todo.completed ? styles.todoItemDisplayCompleted : styles.todoItemDisplayIncomplete
                } ${!todo.deadline ? styles.todoItemNoDDay : ''}`}
            >
              <div
                className={`${styles.todoCheckbox} ${todo.completed ? styles.todoCheckboxCompleted : styles.todoCheckboxIncomplete
                  }`}
              >
                {todo.completed ? (
                  <TodoCheckIcon className={styles.todoCheckboxIcon} />
                ) : (
                  <span className={styles.todoCheckboxEmpty} />
                )}
              </div>

              <span
                className={`${styles.todoText} ${todo.completed ? styles.todoTextCompleted : styles.todoTextIncomplete
                  }`}
              >
                {todo.text}
              </span>

              {todo.deadline && (() => {
                const dday = getDDay(todo.deadline);
                const isOverdue = dday.startsWith('+');
                const badgeColor = todo.completed
                  ? styles.dDayBadgeCompleted
                  : isOverdue
                    ? styles.dDayBadgeOverdue
                    : styles.dDayBadgeUpcoming;
                return (
                  <span className={`${styles.dDayBadge} ${badgeColor}`}>
                    {dday}
                  </span>
                );
              })()}
            </div>
          </div>
        );
      })()}
      {/* Header removed */}

      <div className={styles.todoListItems}>
        {todos.map((todo, index) => (
          <Fragment key={todo.id}>
            {/* DropZone before item */}
            <div
              className={styles.dropZone}
              data-drop-index={index}
            >
              {dropTargetIndex === index && dragIndex !== null && dragIndex !== index && dragIndex !== index - 1 && (
                <div className={styles.dropIndicator} />
              )}
            </div>

            <div
              className={`${styles.todoItem} ${dragIndex === index ? styles.todoItemDragging : ''}`}
              data-todo-index={index} // Still useful for drag start? Actually handleMouseDown uses index closure.
              onMouseDown={(e) => handleMouseDown(e, index)}
              onMouseMove={() => cancelLongPress()}
              onMouseLeave={() => cancelLongPress()}
              onMouseUp={() => cancelLongPress()}
            >
              {editingId === todo.id ? (
                <div className={styles.todoItemEditing}>
                  <input
                    type="text"
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveEdit();
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                    className={styles.todoInput}
                    autoFocus
                    onBlur={(e) => {
                      if (e.relatedTarget && (e.relatedTarget as HTMLElement).closest(`.${styles.todoItemEditing}`)) return;
                    }}
                  />
                  {editDeadline ? (
                    <button
                      onClick={handleShowDatePicker}
                      className={`${styles.dDayBadgeInline} ${(() => { const d = getDDay(editDeadline); return d.startsWith('+') ? styles.dDayBadgeOverdue : styles.dDayBadgeUpcoming; })()}`}
                      title="마감일 수정"
                    >
                      {getDDay(editDeadline)}
                    </button>
                  ) : (
                    <button
                      onClick={handleShowDatePicker}
                      className={`${styles.dDayBadgeInline} ${styles.dDayBadgeDefault}`}
                      title="마감일 설정"
                    >
                      마감일
                    </button>
                  )}
                  <div className={styles.editActions}>
                    <button
                      onClick={handleSaveEdit}
                      className={styles.todoInputButton}
                      title="저장"
                    >
                      <span className={`material-symbols-rounded ${styles.todoInputIcon} ${styles.todoInputIconCheck}`}>check</span>
                    </button>
                    <button
                      onClick={() => handleDeleteInEdit(todo.id, false)}
                      className={styles.todoInputButton}
                      title="삭제"
                    >
                      <span className={`material-symbols-rounded ${styles.todoInputIcon} ${styles.todoInputIconDelete}`}>delete</span>
                    </button>
                  </div>

                  {showDatePicker && (
                    <div className={`${styles.datePickerContainer} ${pickerPosition === 'top' ? styles.datePickerContainerTop : ''}`}>
                      <MiniCalendar
                        startDate={editDeadline || new Date().toISOString().split('T')[0]}
                        endDate={editDeadline || new Date().toISOString().split('T')[0]}
                        target="start"
                        onSelect={(date) => {
                          setEditDeadline(date);
                          setShowDatePicker(false);
                        }}
                        onClose={() => setShowDatePicker(false)}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className={`${styles.todoItemDisplay} ${todo.completed ? styles.todoItemDisplayCompleted : styles.todoItemDisplayIncomplete
                    } ${!todo.deadline ? styles.todoItemNoDDay : ''}`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(todo.id);
                    }}
                    className={`${styles.todoCheckbox} ${todo.completed ? styles.todoCheckboxCompleted : styles.todoCheckboxIncomplete
                      }`}
                    aria-label={todo.completed ? '완료 해제' : '완료'}
                  >
                    {todo.completed ? (
                      <TodoCheckIcon className={styles.todoCheckboxIcon} />
                    ) : (
                      <span className={styles.todoCheckboxEmpty} />
                    )}
                  </button>

                  <span
                    className={`${styles.todoText} ${todo.completed ? styles.todoTextCompleted : styles.todoTextIncomplete
                      }`}
                    onClick={() => handleEdit(todo)}
                  >
                    {todo.text}
                  </span>

                  {todo.deadline && (() => {
                    const dday = getDDay(todo.deadline);
                    const isOverdue = dday.startsWith('+');
                    const badgeColor = todo.completed
                      ? styles.dDayBadgeCompleted
                      : isOverdue
                        ? styles.dDayBadgeOverdue
                        : styles.dDayBadgeUpcoming;
                    return (
                      <span className={`${styles.dDayBadge} ${badgeColor}`}>
                        {dday}
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>
          </Fragment>
        ))}

        {/* Last DropZone */}
        <div
          className={styles.dropZone}
          data-drop-index={todos.length}
        >
          {dropTargetIndex === todos.length && dragIndex !== null && dragIndex !== todos.length - 1 && (
            <div className={styles.dropIndicator} />
          )}
        </div>

        {/* 추가 버튼 및 입력 폼 */}
        {isAdding ? (
          <div className={`${styles.todoItemEditing} ${styles.newItemConfig}`}>
            <input
              type="text"
              value={newTodoText}
              onChange={e => setNewTodoText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') setIsAdding(false);
              }}
              placeholder="할 일 입력..."
              className={styles.todoInput}
              autoFocus
            />
            {newDeadline ? (
              <button
                onClick={handleShowDatePicker}
                className={`${styles.dDayBadgeInline} ${(() => { const d = getDDay(newDeadline); return d.startsWith('+') ? styles.dDayBadgeOverdue : styles.dDayBadgeUpcoming; })()}`}
                title="마감일 수정"
              >
                {getDDay(newDeadline)}
              </button>
            ) : (
              <button
                onClick={handleShowDatePicker}
                className={`${styles.dDayBadgeInline} ${styles.dDayBadgeDefault}`}
                title="마감일 설정"
              >
                마감일
              </button>
            )}
            <div className={styles.editActions}>
              <button
                onClick={handleAdd}
                className={styles.todoInputButton}
                title="저장"
              >
                <span className={`material-symbols-rounded ${styles.todoInputIcon} ${styles.todoInputIconCheck}`}>check</span>
              </button>
              <button
                onClick={() => handleDeleteInEdit('', true)}
                className={styles.todoInputButton}
                title="취소"
              >
                <span className={`material-symbols-rounded ${styles.todoInputIcon} ${styles.todoInputIconDelete}`}>delete</span>
              </button>
            </div>
            {showDatePicker && (
              <div className={`${styles.datePickerContainer} ${pickerPosition === 'top' ? styles.datePickerContainerTop : ''}`}>
                <MiniCalendar
                  startDate={newDeadline || new Date().toISOString().split('T')[0]}
                  endDate={newDeadline || new Date().toISOString().split('T')[0]}
                  target="start"
                  onSelect={(date) => {
                    setNewDeadline(date);
                    setShowDatePicker(false);
                  }}
                  onClose={() => setShowDatePicker(false)}
                />
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className={styles.todoAddButton}
            title="할 일 추가"
          >
            <span className={`material-symbols-rounded ${styles.todoAddIcon}`}>add</span>
          </button>
        )}
      </div>
    </div>
  );
}
