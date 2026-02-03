import { useState } from 'react';
import { Todo } from '../types';
import styles from './TodoList.module.css';
import { TodoCheckIcon } from './TodoCheckIcon';

interface TodoListProps {
  todos: Todo[];
  onAdd: (text: string) => void;
  onToggle: (todoId: string) => void;
  onUpdate: (todoId: string, text: string) => void;
  onDelete: (todoId: string) => void;
  weekLabel: string;
  isMultiMonthWeek?: boolean;
}

export function TodoList({
  todos,
  onAdd,
  onToggle,
  onUpdate,
  onDelete,
  weekLabel,
  isMultiMonthWeek = false,
}: TodoListProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTodoText, setNewTodoText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const handleAdd = () => {
    if (newTodoText.trim()) {
      onAdd(newTodoText.trim());
      setNewTodoText('');
      setIsAdding(false);
    }
  };

  const handleEdit = (todo: Todo) => {
    setEditingId(todo.id);
    setEditText(todo.text);
  };

  const handleSaveEdit = () => {
    if (editingId && editText.trim()) {
      onUpdate(editingId, editText.trim());
      setEditingId(null);
      setEditText('');
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  return (
    <div className={styles.todoList}>
      <div
        className={`${styles.todoListHeader} ${isMultiMonthWeek ? styles.todoListHeaderWide : ''
          }`}
      >
        <h3 className={styles.todoListTitle}>
          {weekLabel}
        </h3>
      </div>

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
                  onBlur={handleCancelEdit}
                />
                <button
                  onClick={handleSaveEdit}
                  className={styles.todoInputButton}
                >
                  <span className={`material-symbols-rounded ${styles.todoInputIcon} ${styles.todoInputIconCheck}`}>check</span>
                </button>
              </div>
            ) : (
              <div
                className={`${styles.todoItemDisplay} ${todo.completed ? styles.todoItemDisplayCompleted : styles.todoItemDisplayIncomplete
                  }`}
              >
                <button
                  onClick={() => onToggle(todo.id)}
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

                {/* 호버 시 액션 버튼 */}
                <div className={styles.todoActions}>
                  <button
                    onClick={() => onDelete(todo.id)}
                    className={`${styles.todoActionButton} ${styles.todoActionButtonDelete}`}
                    title="삭제"
                  >
                    <span className={`material-symbols-rounded ${styles.todoActionIcon} ${styles.todoActionIconDelete}`}>delete</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* 추가 버튼 또는 입력 상자 */}
        {isAdding ? (
          <div className={styles.todoItemEditing}>
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
            <button
              onClick={handleAdd}
              className={styles.todoInputButton}
            >
              <span className={`material-symbols-rounded ${styles.todoInputIcon} ${styles.todoInputIconCheck}`}>check</span>
            </button>
            <button
              onClick={() => setIsAdding(false)}
              className={styles.todoInputButton}
            >
              <span className={`material-symbols-rounded ${styles.todoInputIcon} ${styles.todoInputIconCancel}`}>close</span>
            </button>
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
