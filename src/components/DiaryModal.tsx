import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { DiaryEntry, Event, WeekOrder } from '../types';
import styles from './DiaryModal.module.css';

interface DiaryModalProps {
  date: string;
  events: Event[];

  weekOrder: WeekOrder;
  initialEntry?: DiaryEntry;
  onClose: () => void;
  onSaved: (entry: DiaryEntry) => void;
  onSave: (date: string, title: string, content: string) => Promise<DiaryEntry | null>;
  onDelete: (date: string) => void;
}

export function DiaryModal({
  date,
  events,

  weekOrder,
  initialEntry,
  onClose,
  onSaved,
  onSave,
  onDelete,
}: DiaryModalProps) {
  const [title, setTitle] = useState(initialEntry?.title ?? '');
  const [content, setContent] = useState(initialEntry?.content ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const hasSavedRef = useRef(false);
  const suppressNextSaveRef = useRef(false);
  const lastSyncedRef = useRef({ date: '', title: '', content: '' });
  const contentRef = useRef<HTMLDivElement | null>(null);

  // --- Draft backup helpers ---
  const DRAFT_KEY = `diaryDraft:${date}`;

  const saveDraftToLocal = (t: string, c: string) => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: t, content: c, savedAt: Date.now() }));
    } catch { /* quota exceeded etc. */ }
  };

  const loadDraftFromLocal = (): { title: string; content: string; savedAt: number } | null => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  };

  const clearDraftFromLocal = () => {
    localStorage.removeItem(DRAFT_KEY);
  };

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const normalizeContentToHtml = (value: string) => {
    if (!value) return '<p><br></p>';
    if (/<p[\s>]/i.test(value)) return value;
    return value
      .split(/\r?\n/)
      .map(line => `<p class=\"diaryParagraph\">${escapeHtml(line)}</p>`)
      .join('');
  };

  const getPlainText = (value: string) =>
    value
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim();

  // Track whether this is the initial mount for this date
  const isInitialMountRef = useRef(true);

  // 모달 열림 시 배경 스크롤 잠금
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const nextTitle = initialEntry?.title ?? '';
    const nextContent = normalizeContentToHtml(initialEntry?.content ?? '');
    const isSameDate = lastSyncedRef.current.date === date;

    // Case 1: Date changed → always load new data (switching diary dates)
    if (!isSameDate) {
      setTitle(nextTitle);
      setContent(nextContent);
      if (contentRef.current) {
        contentRef.current.innerHTML = nextContent;
      }
      suppressNextSaveRef.current = true;
      lastSyncedRef.current = { date, title: nextTitle, content: nextContent };
      setLastSavedAt(initialEntry?.updatedAt ?? null);
      setSaveError(null);
      hasSavedRef.current = Boolean(initialEntry);
      isInitialMountRef.current = false;
      return;
    }

    // Case 2: Same date, initial mount → load from initialEntry (or draft)
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;

      // Check for unsaved draft in localStorage
      const draft = loadDraftFromLocal();
      const savedUpdatedAt = initialEntry?.updatedAt ? new Date(initialEntry.updatedAt).getTime() : 0;

      if (draft && draft.savedAt > savedUpdatedAt && (draft.title || getPlainText(draft.content))) {
        // Draft is newer than saved entry → restore draft
        setTitle(draft.title);
        const normalizedDraft = normalizeContentToHtml(draft.content);
        setContent(normalizedDraft);
        if (contentRef.current) {
          contentRef.current.innerHTML = normalizedDraft;
        }
        suppressNextSaveRef.current = false; // Allow immediate save
        lastSyncedRef.current = { date, title: draft.title, content: normalizedDraft };
        setDraftRestored(true);
        hasSavedRef.current = Boolean(initialEntry);
        setLastSavedAt(initialEntry?.updatedAt ?? null);
        setSaveError(null);
        return;
      }

      const isSameContent = lastSyncedRef.current.title === nextTitle
        && lastSyncedRef.current.content === nextContent;
      if (!isSameContent) {
        setTitle(nextTitle);
        setContent(nextContent);
        if (contentRef.current) {
          contentRef.current.innerHTML = nextContent;
        }
        suppressNextSaveRef.current = true;
        lastSyncedRef.current = { date, title: nextTitle, content: nextContent };
      }
      setLastSavedAt(initialEntry?.updatedAt ?? null);
      setSaveError(null);
      hasSavedRef.current = Boolean(initialEntry);
      return;
    }

    // Case 3: Same date, NOT initial mount → user is actively editing
    // Do NOT overwrite user's in-progress work!
    // Only update the saved-at timestamp if the backend returns a newer one
    if (initialEntry?.updatedAt) {
      setLastSavedAt(initialEntry.updatedAt);
    }
  }, [date, initialEntry]);

  useEffect(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(async () => {
      if (suppressNextSaveRef.current) {
        suppressNextSaveRef.current = false;
        return;
      }

      if (
        hasSavedRef.current
        && lastSyncedRef.current.date === date
        && lastSyncedRef.current.title === title
        && lastSyncedRef.current.content === content
      ) {
        return;
      }

      const hasText = Boolean(title.trim() || getPlainText(content));
      if (!hasText && !hasSavedRef.current) {
        return;
      }

      // Save draft to localStorage immediately (backup)
      saveDraftToLocal(title, content);

      setIsSaving(true);
      const saved = await onSave(date, title, content);
      if (saved) {
        onSaved(saved);
        hasSavedRef.current = true;
        lastSyncedRef.current = { date, title, content };
        setLastSavedAt(saved.updatedAt ?? null);
        setSaveError(null);
        setDraftRestored(false);
        clearDraftFromLocal(); // Saved successfully, remove draft
      } else {
        setSaveError('저장 실패 — 로컬에 임시 저장됨');
        // Keep draft in localStorage as backup
      }
      setIsSaving(false);
    }, 500);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [date, title, content, onSave, onSaved]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const ensureParagraphStructure = () => {
    const root = contentRef.current;
    if (!root) return;

    const children = Array.from(root.childNodes);
    if (children.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'diaryParagraph';
      empty.appendChild(document.createElement('br'));
      root.appendChild(empty);
      return;
    }

    const wrapInlineIntoParagraph = (node: ChildNode) => {
      const paragraph = document.createElement('p');
      paragraph.className = 'diaryParagraph';
      paragraph.appendChild(node);
      return paragraph;
    };

    children.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (text.trim().length === 0) {
          node.remove();
          return;
        }
        root.replaceChild(wrapInlineIntoParagraph(document.createTextNode(text)), node);
        return;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        if (element.tagName === 'P') {
          element.classList.add('diaryParagraph');
          const nestedParagraphs = element.querySelectorAll('p');
          nestedParagraphs.forEach(nested => {
            const unwrap = document.createElement('span');
            while (nested.firstChild) {
              unwrap.appendChild(nested.firstChild);
            }
            nested.replaceWith(unwrap);
          });
          if (element.innerHTML.trim() === '') {
            element.innerHTML = '<br>';
          }
          return;
        }

        if (element.tagName === 'BR') {
          const paragraph = document.createElement('p');
          paragraph.className = 'diaryParagraph';
          paragraph.appendChild(document.createElement('br'));
          root.replaceChild(paragraph, element);
          return;
        }

        if (element.tagName === 'DIV') {
          const paragraph = document.createElement('p');
          paragraph.className = 'diaryParagraph';
          paragraph.innerHTML = element.innerHTML || '<br>';
          root.replaceChild(paragraph, element);
          return;
        }

        root.replaceChild(wrapInlineIntoParagraph(element), element);
      }
    });
  };

  const insertParagraph = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const paragraph = document.createElement('p');
    paragraph.className = 'diaryParagraph';
    paragraph.appendChild(document.createElement('br'));

    const parentElement = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
    const currentParagraph = parentElement?.closest('p');

    if (currentParagraph && currentParagraph.parentElement) {
      currentParagraph.parentElement.insertBefore(paragraph, currentParagraph.nextSibling);
    } else if (contentRef.current) {
      contentRef.current.appendChild(paragraph);
    }

    const newRange = document.createRange();
    newRange.setStart(paragraph, 0);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
  };

  const handleContentInput = () => {
    if (!contentRef.current) return;

    ensureParagraphStructure();
    setContent(contentRef.current.innerHTML);
  };

  const handleContentKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const br = document.createElement('br');
      range.insertNode(br);
      range.setStartAfter(br);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      handleContentInput();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      insertParagraph();
      handleContentInput();
    }
  };

  const isContentEmpty = getPlainText(content).length === 0;

  const dateObj = new Date(`${date}T00:00:00`);
  const dayNames = weekOrder === 'sun'
    ? ['일', '월', '화', '수', '목', '금', '토']
    : ['월', '화', '수', '목', '금', '토', '일'];
  const dayIndex = dateObj.getDay();
  const dayName = dayNames[weekOrder === 'sun' ? dayIndex : (dayIndex === 0 ? 6 : dayIndex - 1)];
  const isWeekend = dayIndex === 0 || dayIndex === 6;

  const formatEventTime = (startTime?: string, endTime?: string) => {
    const formatTime = (time: string) => {
      const [hours, minutes] = time.split(':');
      const hour = parseInt(hours, 10);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${minutes} ${ampm}`;
    };

    if (startTime && endTime) {
      return `${formatTime(startTime)} - ${formatTime(endTime)}`;
    } else if (startTime) {
      return formatTime(startTime);
    } else if (endTime) {
      return `~ ${formatTime(endTime)}`;
    }
    return '';
  };

  return (
    <div className={styles.overlay}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarContent}>
          <div className={styles.dayHeader}>

            <div className={styles.dayMeta}>
              <span className={`${styles.dayName} ${isWeekend ? styles.dayNameWeekend : styles.dayNameWeekday}`}>
                {dayName}
              </span>
              <span className={`${styles.dayNumber} ${isWeekend ? styles.dayNumberWeekend : styles.dayNumberWeekday}`}>
                {dateObj.getDate()}
              </span>
            </div>
          </div>
          <div className={styles.dayEvents}>
            {events.length === 0 ? (
              <div className={styles.emptyEvents}>일정 없음</div>
            ) : (
              <div className={styles.eventsList}>
                {events.map(event => (
                  <div
                    key={event.id}
                    className={styles.eventItem}
                    style={{ borderLeftColor: event.color }}
                  >
                    {(event.startTime || event.endTime) && (
                      <div className={styles.eventTime}>
                        {formatEventTime(event.startTime, event.endTime)}
                      </div>
                    )}
                    <div className={styles.eventTitle}>{event.title}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        <div className={styles.container}>
          <button className={styles.closeButton} onClick={onClose} aria-label="닫기">
            <span className={`material-symbols-rounded ${styles.closeIcon}`}>close</span>
          </button>
          <div className={styles.header}>
            <div className={styles.saveStatus}>
              {isSaving ? '저장 중...' : saveError ? saveError : draftRestored ? '임시 저장에서 복구됨' : lastSavedAt ? '저장됨' : ''}
            </div>
          </div>
          <input
            className={styles.titleInput}
            placeholder="제목"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div
            ref={contentRef}
            className={styles.contentInput}
            contentEditable
            suppressContentEditableWarning
            data-placeholder="오늘은 어땠나요?"
            data-empty={isContentEmpty}
            onInput={handleContentInput}
            onKeyDown={handleContentKeyDown}
          />
        </div>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={() => onDelete(date)}
          aria-label="일기 삭제"
        >
          <span className={`material-symbols-rounded ${styles.deleteIcon}`}>delete</span>
        </button>
      </div>
    </div>
  );
}
