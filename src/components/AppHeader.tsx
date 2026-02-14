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
  showTodos: boolean;
  onToggleTodos: () => void;
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
  showTodos,
  onToggleTodos,
}: AppHeaderProps) {
  return (
    <div className={styles.appHeader}>
      <div className={styles.appHeaderContent}>
        <div className={styles.appHeaderLeft}>
          <h1 className={styles.appHeaderTitle}>
            {currentYear}년 {currentMonth}월
          </h1>
          <button
            onClick={onScrollToToday}
            className={`${styles.appHeaderButton} ${styles.appHeaderButtonToday}`}
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
                    ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
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
      </div>
    </div>
  );
}
