import { useEffect, useRef, useState } from 'react';
import styles from './Landing.module.css';
import { trackMarketingEvent } from '../../lib/marketingAnalytics';

interface LandingPageProps {
  onStart: () => void;
}

interface LaunchPricingPlan {
  name: string;
  badge: string;
  price: string;
  description: string;
  bullets: readonly string[];
  cta: string;
  planKey: 'free' | 'pro';
  note?: string;
}

const launchPricingPlans: readonly LaunchPricingPlan[] = [
  {
    name: 'Free',
    badge: '계속 무료',
    price: '0원',
    description: '주간 캘린더의 기본 가치를 충분히 느끼게 해주는 시작 플랜',
    bullets: [
      '주간 캘린더와 기본 일정 관리',
      '루틴, 할일, 일기, 감정 기록',
      '기본 캘린더 통합과 가벼운 개인 사용',
    ],
    cta: '무료로 시작하기',
    planKey: 'free',
  },
  {
    name: 'Pro',
    badge: '런칭 얼리어답터',
    price: '$7.99',
    description: '파워유저를 위한 고급 워크플로우와 자동화를 여는 플랜',
    bullets: [
      '가입 즉시 14일 Pro 전체 체험',
      '고급 뷰, 필터, 커스터마이징',
      '확장 연동, 자동화, 향후 AI 기능 우선 제공',
    ],
    note: '연간 결제 $69 예정',
    cta: '14일 Pro 체험 시작',
    planKey: 'pro',
  },
] as const;

const trialSteps = [
  {
    step: '1',
    title: '가입하면 바로 14일 Pro',
    description: '카드 입력 없이 모든 Pro 기능을 열어두고, 첫 2주 안에 진짜 습관이 맞는지 확인합니다.',
  },
  {
    step: '2',
    title: '체험이 끝나면 Free로 자동 전환',
    description: '달력과 기록은 그대로 유지되고, 고급 기능만 잠깁니다. 억지 결제 유도는 하지 않습니다.',
  },
  {
    step: '3',
    title: '답답해지는 순간에 업그레이드',
    description: '더 많은 뷰와 자동화가 필요해질 때 Pro로 올리면 됩니다. 무료도 실제로 계속 쓸 수 있게 설계합니다.',
  },
] as const;

const launchMetrics = [
  '첫 3일 안에 캘린더 연결하기',
  '첫 이벤트 만들기와 첫 주간 뷰 진입',
  '14일 체험 시작 대비 유료 전환율',
  '무료 사용자 4주 유지율',
] as const;

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

const SCREENSHOT_BASE = '/landing/';

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
          시간을 재즈처럼
        </h1>
        <p className={styles.heroSub}>
          일정 · 루틴 · 할일 · 일기 · 감정까지 하나로. 기본 기능은 계속 무료, Pro는 14일 먼저 써보고 결정하세요.
        </p>
        <div className={styles.heroButtons}>
          <button className={styles.btnPrimary} onClick={onStart}>
            시작하기 Free
          </button>
          <button className={styles.btnGhost} onClick={scrollToFeatures}>
            아래로 더 보기
            <ArrowDownIcon />
          </button>
        </div>
      </div>

      <div className={styles.heroScreen}>
        <Screenshot
          filename="screenshot-hero.jpg"
          hint="앱 전체 화면 스크린샷을 이곳에 추가하세요"
          aspectRatio="16 / 10"
        />
      </div>
    </section>
  );
}

function PricingSection({ onStart }: { onStart: () => void }) {
  const handlePlanClick = (planKey: 'free' | 'pro') => {
    trackMarketingEvent('pricing_cta_clicked', {
      plan: planKey,
      entryPoint: 'pricing-section',
    });
    onStart();
  };

  return (
    <section id="pricing" className={styles.pricingSection}>
      <div className={styles.pricingHeader}>
        <p className={styles.sectionEyebrow}>Launch Pricing</p>
        <h2 className={styles.sectionTitle}>출시 가격은 낮게, 업그레이드 이유는 분명하게</h2>
        <p className={styles.sectionDescription}>
          몇 달 무료 대신, 계속 쓸 수 있는 Free와 충분히 써보고 결정하는 14일 Pro 체험으로 시작합니다.
        </p>
      </div>

      <div className={styles.pricingGrid}>
        {launchPricingPlans.map((plan) => (
          <article
            key={plan.name}
            className={`${styles.pricingCard}${plan.planKey === 'pro' ? ` ${styles.pricingCardFeatured}` : ''}`}
          >
            <div className={styles.pricingCardHeader}>
              <div>
                <p className={styles.pricingPlanName}>{plan.name}</p>
                <span className={styles.pricingBadge}>{plan.badge}</span>
              </div>
              <div className={styles.pricingPriceWrap}>
                <strong className={styles.pricingPrice}>{plan.price}</strong>
                {plan.planKey === 'pro' && <span className={styles.pricingPerMonth}>/ month</span>}
              </div>
            </div>

            <p className={styles.pricingCardDescription}>{plan.description}</p>

            <ul className={styles.pricingBulletList}>
              {plan.bullets.map((bullet) => (
                <li key={bullet} className={styles.pricingBulletItem}>
                  <span className={styles.pricingBulletIcon}>
                    <CheckSquareIcon />
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>

            {plan.note && <p className={styles.pricingNote}>{plan.note}</p>}

            <button className={styles.pricingButton} onClick={() => handlePlanClick(plan.planKey)}>
              {plan.cta}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function TrialFlowSection() {
  return (
    <section className={styles.trialSection}>
      <div className={styles.trialHeader}>
        <p className={styles.sectionEyebrow}>Trial Flow</p>
        <h2 className={styles.sectionTitle}>짧지만 충분한 체험, 강요 없는 전환</h2>
        <p className={styles.sectionDescription}>
          출시 초기에 중요한 건 억지로 결제시키는 게 아니라, 제품이 생활에 들어오는 순간을 빠르게 만드는 일입니다.
        </p>
      </div>

      <div className={styles.trialGrid}>
        {trialSteps.map((step) => (
          <article key={step.step} className={styles.trialCard}>
            <span className={styles.trialStep}>{step.step}</span>
            <h3 className={styles.trialTitle}>{step.title}</h3>
            <p className={styles.trialDescription}>{step.description}</p>
          </article>
        ))}
      </div>

      <div className={styles.metricsPanel}>
        <h3 className={styles.metricsTitle}>런칭 직후 가장 먼저 볼 지표</h3>
        <ul className={styles.metricsList}>
          {launchMetrics.map((metric) => (
            <li key={metric} className={styles.metricsItem}>
              {metric}
            </li>
          ))}
        </ul>
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
  const pricingSectionRef = useRef<HTMLDivElement | null>(null);
  const trialSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;

    const seenSections = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const trackedSection = entry.target.getAttribute('data-track-section');
          if (!trackedSection || seenSections.has(trackedSection)) return;

          seenSections.add(trackedSection);
          trackMarketingEvent(trackedSection as 'pricing_section_viewed' | 'trial_flow_viewed', {
            entryPoint: 'landing',
          });
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.35 }
    );

    const sections = [pricingSectionRef.current, trialSectionRef.current].filter(Boolean) as HTMLElement[];
    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, []);

  const handleStartClick = (source: string) => {
    trackMarketingEvent('marketing_cta_clicked', {
      source,
      entryPoint: 'landing',
    });
    onStart();
  };

  return (
    <div className={styles.landing}>
      <Navbar onStart={() => handleStartClick('navbar')} />

      <main>
        <HeroSection onStart={() => handleStartClick('hero')} />

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
            imageName="screenshot-weekly.jpg"
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

        <div ref={pricingSectionRef} data-track-section="pricing_section_viewed">
          <PricingSection onStart={() => handleStartClick('pricing')} />
        </div>

        <div ref={trialSectionRef} data-track-section="trial_flow_viewed">
          <TrialFlowSection />
        </div>

        <CTASection onStart={() => handleStartClick('final-cta')} />
      </main>

      <Footer />
    </div>
  );
}
