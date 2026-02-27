import { RefObject } from 'react';
import styles from '../App.module.css';

interface AppHeaderProps {
  currentYear: number;
  currentMonth: number;
  avatarUrl: string | null;
  userInitial: string;
  profileMenuRef: RefObject<HTMLDivElement | null>;
  isProfileMenuOpen: boolean;
  onScrollToToday: () => void;
  onToggleProfileMenu: () => void;
  onOpenRoutine: () => void;

  onOpenSettings: () => void;
  onOpenTimeSettings: () => void;
  onLogout: () => void;
  showRoutines: boolean;
  onToggleRoutines: () => void;
  showDiary: boolean;
  onToggleDiary: () => void;
  showEmotion: boolean;
  onToggleEmotion: () => void;
  showTodos: boolean;
  onToggleTodos: () => void;
  isCalendarPopupOpen: boolean;
  onToggleCalendarPopup: () => void;
  calendarPopupNode?: React.ReactNode;
}

export function AppHeader({
  currentYear,
  currentMonth,
  avatarUrl,
  userInitial,
  profileMenuRef,
  isProfileMenuOpen,
  onScrollToToday,
  onToggleProfileMenu,
  onOpenRoutine,

  onOpenSettings,
  onOpenTimeSettings,
  onLogout,
  showRoutines,
  onToggleRoutines,
  showDiary,
  onToggleDiary,
  showEmotion,
  onToggleEmotion,
  showTodos,
  onToggleTodos,
  isCalendarPopupOpen,
  onToggleCalendarPopup,
  calendarPopupNode,
}: AppHeaderProps) {
  return (
    <div className={styles.appHeader}>
      <div className={styles.appHeaderLeft}>
        {!isCalendarPopupOpen && (
          <button
            onClick={onToggleCalendarPopup}
            className={styles.toggleButton}
            aria-label="캘린더 목록"
          >
            <span className="material-symbols-rounded">calendar_month</span>
          </button>
        )}
        {calendarPopupNode}
      </div>

      <div className={styles.appHeaderCenter}>
        <h1 className={styles.appHeaderTitle}>
          {currentYear}. {String(currentMonth).padStart(2, '0')}
        </h1>
        <button
          onClick={onScrollToToday}
          className={`${styles.appHeaderButton}`}
        >
          오늘
        </button>
      </div>

      <div className={styles.appHeaderRight}>
        <div className={styles.profileWrapper} ref={profileMenuRef}>
          {/* 썸네일: 메뉴가 열려있지 않을 때만 표시 */}
          {!isProfileMenuOpen && (
            <button
              onClick={onToggleProfileMenu}
              className={styles.profileButton}
              aria-haspopup="menu"
              aria-expanded={isProfileMenuOpen}
              style={
                avatarUrl
                  ? { backgroundImage: `url(${avatarUrl})` }
                  : undefined
              }
            >
              {!avatarUrl && (
                <span className={styles.profileInitial}>
                  {userInitial}
                </span>
              )}
            </button>
          )}
          {isProfileMenuOpen && (
            <div className={styles.profileMenu} role="menu">
              {/* Header (Title + Close) Removed */}


              {/* 루틴 관리 */}
              <div className={styles.profileMenuItemGroup}>
                <span className={styles.profileMenuLabel}>루틴</span>
                <div className={styles.profileMenuRightControls}>
                  <label className={styles.toggleSwitch}>
                    <input
                      type="checkbox"
                      checked={showRoutines}
                      onChange={onToggleRoutines}
                    />
                    <span className={styles.toggleSlider}></span>
                  </label>
                  <span
                    className="material-symbols-rounded"
                    style={{ fontSize: '16px', color: '#9ca3af', cursor: 'pointer' }}
                    onClick={onOpenRoutine}
                  >arrow_forward_ios</span>
                </div>
              </div>

              {/* 일기 */}
              <div className={styles.profileMenuItemGroup}>
                <span className={styles.profileMenuLabel}>일기</span>
                <div className={styles.profileMenuRightControls}>
                  <label className={styles.toggleSwitch}>
                    <input
                      type="checkbox"
                      checked={showDiary}
                      onChange={onToggleDiary}
                    />
                    <span className={styles.toggleSlider}></span>
                  </label>
                  <span style={{ width: '16px' }} />
                </div>
              </div>

              {/* 오늘의 기분 */}
              <div className={styles.profileMenuItemGroup}>
                <span className={styles.profileMenuLabel}>오늘의 기분</span>
                <div className={styles.profileMenuRightControls}>
                  <label className={styles.toggleSwitch}>
                    <input
                      type="checkbox"
                      checked={showEmotion}
                      onChange={onToggleEmotion}
                    />
                    <span className={styles.toggleSlider}></span>
                  </label>
                  <span style={{ width: '16px' }} />
                </div>
              </div>

              {/* 투두 리스트 */}
              <div className={styles.profileMenuItemGroup}>
                <span className={styles.profileMenuLabel}>할일</span>
                <div className={styles.profileMenuRightControls}>
                  <label className={styles.toggleSwitch}>
                    <input
                      type="checkbox"
                      checked={showTodos}
                      onChange={onToggleTodos}
                    />
                    <span className={styles.toggleSlider}></span>
                  </label>
                  <span style={{ width: '16px' }} />
                </div>
              </div>

              <button className={styles.profileMenuItem} onClick={onOpenSettings}>
                프로필
              </button>
              <button className={styles.profileMenuItem} onClick={onOpenTimeSettings}>
                시간
              </button>
              <button className={styles.profileMenuItem} onClick={onLogout}>
                로그아웃
              </button>
            </div>
          )}
        </div>
      </div>
    </div >
  );
}
