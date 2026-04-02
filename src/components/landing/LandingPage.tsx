import { useState } from 'react';
import styles from './Landing.module.css';

interface LandingPageProps {
  onStart: () => void;
}

// ─── Icons (inline SVG, no external dependency) ───────────────────────────────

function CalendarIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="18" rx="2" strokeWidth="2" />
      <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2" />
      <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2" />
      <line x1="3" y1="10" x2="21" y2="10" strokeWidth="2" />
    </svg>
  );
}

function CheckSquareIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <polyline points="9 11 12 14 22 4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RefreshCwIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <polyline points="1 4 1 10 7 10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="23 20 23 14 17 14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BookOpenIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19" strokeWidth="2" strokeLinecap="round" />
      <polyline points="19 12 12 19 5 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


function ImagePlaceholderIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" strokeWidth="0" />
      <path d="M21 15l-5-5L5 21" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Screenshot helper ─────────────────────────────────────────────────────────

const SCREENSHOT_BASE = '/screenshots/';

interface ScreenshotProps {
  filename: string;
  hint: string;
  aspectRatio?: string;
}

function Screenshot({ filename, hint, aspectRatio = '4 / 3' }: ScreenshotProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const src = `${SCREENSHOT_BASE}${filename}`;

  return (
    <div className={styles.screenshotBox}>
      {!error && (
        <img
          src={src}
          alt={hint}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          style={{ display: loaded ? 'block' : 'none' }}
        />
      )}
      {(!loaded || error) && (
        <div className={error ? styles.featurePlaceholder : styles.screenshotPlaceholder}
          style={{ aspectRatio }}>
          <div className={styles.placeholderIcon}>
            <ImagePlaceholderIcon size={error ? 20 : 28} />
          </div>
          <p>
            {filename}
            <br />
            <span style={{ fontSize: '0.7rem' }}>({hint})</span>
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

function Navbar({ onStart }: { onStart: () => void }) {
  return (
    <header className={styles.navbar}>
      <div className={styles.navInner}>
        <div className={styles.logo}>
          <img src="/images/riff_logo.svg" alt="Riff" />
        </div>
        <button className={styles.navCta} onClick={onStart}>
          시작하기
        </button>
      </div>
    </header>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function HeroSection({ onStart }: { onStart: () => void }) {
  const scrollToFeatures = () => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className={styles.hero}>
      <div className={styles.heroContent}>
        <h1 className={styles.heroTitle}>
          당신의 한 주를,
          <br />
          <span className={styles.heroTitleAccent}>제대로 살아봐</span>
        </h1>
        <p className={styles.heroSub}>
          일정 · 루틴 · 할일 · 일기 · 감정까지 — 흩어진 것들을 하나로
        </p>
        <div className={styles.heroButtons}>
          <button className={styles.btnPrimary} onClick={onStart}>
            시작하기 — 무료
          </button>
          <button className={styles.btnGhost} onClick={scrollToFeatures}>
            아래로 더 보기
            <ArrowDownIcon />
          </button>
        </div>
      </div>

      <div className={styles.heroScreen}>
        <Screenshot
          filename="screenshot-hero.png"
          hint="앱 전체 화면 스크린샷을 이곳에 추가하세요"
          aspectRatio="16 / 10"
        />
      </div>
    </section>
  );
}

// ─── Feature Section base ─────────────────────────────────────────────────────

interface FeatureSectionProps {
  id?: string;
  reverse?: boolean;
  title: string;
  subtitle: string;
  description?: string;
  bullets?: { icon: React.ReactNode; text: string }[];
  imageName: string;
  imageHint: string;
}

function FeatureSection({
  id,
  reverse = false,
  title,
  subtitle,
  description,
  bullets,
  imageName,
  imageHint,
}: FeatureSectionProps) {
  return (
    <section id={id} className={styles.featureSection}>
      <div className={`${styles.featureInner}${reverse ? ` ${styles.reverse}` : ''}`}>
        <div className={styles.featureImage}>
          <Screenshot filename={imageName} hint={imageHint} />
        </div>
        <div className={styles.featureContent}>
          <h2 className={styles.featureTitle}>{title}</h2>
          <p className={styles.featureSub}>{subtitle}</p>
          {description && <p className={styles.featureDesc}>{description}</p>}
          {bullets && bullets.length > 0 && (
            <ul className={styles.bulletList}>
              {bullets.map((b, i) => (
                <li key={i} className={styles.bulletItem}>
                  <span className={styles.bulletIconWrap}>{b.icon}</span>
                  <span>{b.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── CTA ──────────────────────────────────────────────────────────────────────

function CTASection({ onStart }: { onStart: () => void }) {
  return (
    <section className={styles.cta}>
      <div className={styles.ctaInner}>
        <h2 className={styles.ctaTitle}>오늘부터 시작해봐요.</h2>
        <p className={styles.ctaSub}>무료로, 지금 바로.</p>
        <button className={styles.btnPrimary} onClick={onStart}>
          시작하기 — 무료
        </button>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerLogo}>
          <div className={styles.footerLogoIcon}>
            <CalendarIcon size={14} />
          </div>
          <span>Riff © 2025</span>
        </div>
        <div className={styles.legalLinks}>
          <a className={styles.legalLink} href="/privacy">
            개인정보처리방침
          </a>
          <span className={styles.legalDivider}>|</span>
          <a className={styles.legalLink} href="/terms">
            이용약관
          </a>
        </div>
      </div>
    </footer>
  );
}

// ─── LandingPage (root) ───────────────────────────────────────────────────────

export function LandingPage({ onStart }: LandingPageProps) {
  return (
    <div className={styles.landing}>
      <Navbar onStart={onStart} />

      <main>
        <HeroSection onStart={onStart} />

        <div className={styles.features} id="features">
          <FeatureSection
            title="월 단위 달력은 이제 그만"
            subtitle="Riff는 처음부터 '이번 주'를 위해 만들어졌어요."
            bullets={[
              { icon: <CalendarIcon size={16} />, text: '일정 — 시간 단위로 정확하게' },
              { icon: <CheckSquareIcon />, text: '할일 — 이번 주 안에 끝낼 것들' },
              { icon: <RefreshCwIcon />, text: '루틴 — 매일 반복되는 나만의 습관' },
              { icon: <BookOpenIcon />, text: '일기 — 오늘 하루를 한 줄로' },
              { icon: <HeartIcon />, text: '감정 — 내가 어떤 날이었는지' },
            ]}
            imageName="screenshot-weekly.png"
            imageHint="주간 그리드 클로즈업"
          />
          <FeatureSection
            reverse
            title="iCloud도, Google도, 다 여기서"
            subtitle="따로 앱 열지 않아도 돼요. 연결만 해두면 Riff가 알아서 합쳐줘요."
            description="iCloud 캘린더, Google Calendar, 직접 만든 로컬 캘린더를 하나의 화면에서."
            imageName="screenshot-multicalendar.png"
            imageHint="캘린더 목록 사이드바"
          />
          <FeatureSection
            title='"오늘도 했다" — 그 기분을 매일'
            subtitle="반복 일정이 아니에요. 나만의 루틴이에요."
            description="요일별로 루틴을 설정하고, 날마다 체크해요. 작은 성취가 쌓이는 게 보이니까 계속하게 돼요."
            imageName="screenshot-routine.png"
            imageHint="루틴 아이콘+체크 화면"
          />
          <FeatureSection
            reverse
            title="일기 쓰기, 이제 3초면 돼"
            subtitle="오늘 기분이 어땠는지 이모지 하나, 한 줄 메모면 충분해요."
            description="자동저장이라 저장 버튼도 없어요. 그냥 쓰다가 닫으면 돼요."
            imageName="screenshot-diary-emotion.png"
            imageHint="일기 모달 + 감정 이모지"
          />
          <FeatureSection
            title="어디서 추가해도, 바로 보여요"
            subtitle="새로고침 없이, 기다림 없이 — 내가 바꾼 건 즉시 반영돼요."
            description="Supabase Realtime 기반으로 여러 기기에서 동시에 써도 항상 최신 상태를 유지해요."
            imageName="screenshot-realtime.png"
            imageHint="실시간 동기화 화면"
          />
          <FeatureSection
            reverse
            title="책상 앞에서도, 이동 중에도"
            subtitle="웹이랑 앱이 같은 데이터를 써요. 어디서든 이어서 쓸 수 있어요."
            description="iOS · Android 앱도 함께 출시 예정이에요."
            imageName="screenshot-mobile.png"
            imageHint="모바일 앱 주간 뷰"
          />
          <FeatureSection
            title="일정 바꾸는 게 이렇게 쉬울 줄은"
            subtitle="끌어다 놓으면 끝. 잘못 옮겼으면 ⌘Z."
            description="드래그&드롭으로 일정을 이동하고, 실수했을 땐 Cmd+Z로 바로 되돌려요."
            imageName="screenshot-drag.png"
            imageHint="드래그 중 ghost 효과"
          />
        </div>

        <CTASection onStart={onStart} />
      </main>

      <Footer />
    </div>
  );
}
