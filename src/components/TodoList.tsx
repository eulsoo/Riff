import { useState } from 'react';
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
}

export function TodoList({
  todos,
  onAdd,
  onToggle,
  onUpdate,
  onDelete,
}: TodoListProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTodoText, setNewTodoText] = useState('');
  const [newDeadline, setNewDeadline] = useState<string | undefined>(undefined);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editDeadline, setEditDeadline] = useState<string | undefined>(undefined);

  const [showDatePicker, setShowDatePicker] = useState(false);

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
    <div className={styles.todoList}>
      {/* Header removed */}

      <div className={styles.todoListItems}>
        {todos.map(todo => (
          <div
            key={todo.id}
            className={styles.todoItem}
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
                    // Prevent blur if clicking related buttons
                    if (e.relatedTarget && (e.relatedTarget as HTMLElement).closest(`.${styles.todoItemEditing}`)) return;
                    // handleCancelEdit(); // Optional: Auto-cancel/save on blur? Usually auto-save is better or stay open.
                    // User requested specific behavior? "todoItemEditing 모드... check, Delete, Today"
                    // Often blur saves in todo lists, or just keeps it open.
                    // Let's NOT auto-close on blur to allow interacting with buttons safely, 
                    // or implement robust click-outside detection.
                    // For now, removing simple onBlur to verify button interactions work.
                  }}
                />
                {editDeadline ? (
                  <button
                    onClick={() => setShowDatePicker(!showDatePicker)}
                    className={`${styles.dDayBadgeInline} ${(() => { const d = getDDay(editDeadline); return d.startsWith('+') ? styles.dDayBadgeOverdue : styles.dDayBadgeUpcoming; })()}`}
                    title="마감일 수정"
                  >
                    {getDDay(editDeadline)}
                  </button>
                ) : (
                  <button
                    onClick={() => setShowDatePicker(!showDatePicker)}
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
                  <div className={styles.datePickerContainer}>
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
        ))}

        {/* 추가 버튼 또는 입력 상자 */}
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
                onClick={() => setShowDatePicker(!showDatePicker)}
                className={`${styles.dDayBadgeInline} ${(() => { const d = getDDay(newDeadline); return d.startsWith('+') ? styles.dDayBadgeOverdue : styles.dDayBadgeUpcoming; })()}`}
                title="마감일 수정"
              >
                {getDDay(newDeadline)}
              </button>
            ) : (
              <button
                onClick={() => setShowDatePicker(!showDatePicker)}
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
              <div className={styles.datePickerContainer}>
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
