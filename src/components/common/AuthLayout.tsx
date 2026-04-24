import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Zap, TrendingUp, Globe2 } from 'lucide-react';
import QuantaLogo from './QuantaLogo';
import LangSwitch from './LangSwitch';
import { useI18n } from '../../i18n';

// ============================================================================
// AuthLayout — Binance-style 2-column authentication layout
// ----------------------------------------------------------------------------
// Desktop (≥lg): split screen
//   Left  (≈55%): Brand hero – dark gradient with logo, headline, benefit list,
//                 trading-themed background pattern.
//   Right (≈45%): Scrollable form container centered, max-w-[440px].
// Tablet/Mobile (<lg): Single column, form full-width with sticky top bar.
//
// This matches real Binance/Upbit/Coinbase login-register PC layout.
// ============================================================================

interface AuthLayoutProps {
  children: ReactNode;
  /** Variant selects which hero content to render on the left pane */
  variant?: 'login' | 'register' | 'recover';
}

export default function AuthLayout({ children, variant = 'login' }: AuthLayoutProps) {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-exchange-bg flex flex-col lg:flex-row">
      {/* ================================================================ */}
      {/* LEFT PANE — Brand hero (desktop only)                             */}
      {/* ================================================================ */}
      <aside
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden
                   bg-gradient-to-br from-[#0B0E11] via-[#13171D] to-[#1E2329]"
      >
        {/* Decorative grid + glow */}
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(240,185,11,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(240,185,11,0.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-exchange-yellow/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 right-0 w-[520px] h-[520px] rounded-full bg-exchange-buy/10 blur-3xl pointer-events-none" />

        {/* Inner column — centered inside the left pane */}
        <div className="relative w-full flex flex-col mx-auto max-w-[560px] px-10 xl:px-14 py-8">
          {/* Top brand row */}
          <div className="flex items-center justify-between z-10">
            <Link to="/home" className="flex items-center group">
              <QuantaLogo size={32} />
            </Link>
            <Link
              to="/home"
              className="text-sm text-exchange-text-secondary hover:text-exchange-yellow transition-colors"
            >
              ← {t('common.home')}
            </Link>
          </div>

          {/* Hero content — vertically centered in the remaining space */}
          <div className="flex-1 flex flex-col justify-center z-10 py-10">
            <HeroContent variant={variant} />
          </div>

          {/* Bottom trust row */}
          <div className="flex items-center justify-between text-[12px] text-exchange-text-third z-10">
            <div className="flex items-center gap-5">
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-exchange-buy" />
                {t('auth.heroBadgeSecure')}
              </span>
              <span className="flex items-center gap-1.5">
                <Globe2 size={14} className="text-exchange-yellow" />
                {t('auth.heroBadgeGlobal')}
              </span>
            </div>
            <span>© {new Date().getFullYear()} QuantaEX</span>
          </div>
        </div>
      </aside>

      {/* ================================================================ */}
      {/* RIGHT PANE — Form                                                 */}
      {/* ================================================================ */}
      <section className="flex-1 flex flex-col min-h-screen lg:min-h-0">
        {/* Mobile/Tablet top bar (hidden on lg, left pane replaces it) */}
        <header
          className="lg:hidden sticky top-0 z-30 bg-exchange-bg/95 backdrop-blur
                     border-b border-exchange-border/40"
        >
          <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
            <Link
              to="/home"
              className="p-1 -ml-1 hover:bg-exchange-hover rounded-md transition-colors"
              aria-label="back"
            >
              <ArrowLeft size={22} className="text-exchange-text" />
            </Link>
            <Link to="/home" className="flex items-center gap-2">
              <QuantaLogo size={24} />
            </Link>
            <div className="flex items-center gap-2">
              <LangSwitch />
            </div>
          </div>
        </header>

        {/* Desktop language switch — top-right of form pane */}
        <div className="hidden lg:flex absolute right-8 top-6 z-30">
          <LangSwitch />
        </div>

        {/* Form body — centered inside the right pane */}
        <main className="flex-1 flex lg:items-center justify-center">
          <div
            className="w-full max-w-md px-5 lg:px-0 lg:max-w-[440px]
                       pt-6 lg:pt-12 pb-28 lg:pb-12"
          >
            {children}
          </div>
        </main>
      </section>
    </div>
  );
}

// ============================================================================
// Hero content per variant
// ============================================================================
function HeroContent({ variant }: { variant: 'login' | 'register' | 'recover' }) {
  const { t } = useI18n();

  if (variant === 'recover') {
    return (
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-exchange-yellow/10 border border-exchange-yellow/30 mb-6">
          <ShieldCheck size={14} className="text-exchange-yellow" />
          <span className="text-xs font-semibold text-exchange-yellow tracking-wide">
            {t('auth.heroRecoverBadge')}
          </span>
        </div>
        <h2 className="text-4xl xl:text-5xl font-extrabold text-exchange-text leading-[1.12] mb-5">
          {t('auth.heroRecoverTitle')}
        </h2>
        <p className="text-[15px] text-exchange-text-secondary leading-relaxed mb-10 max-w-[480px]">
          {t('auth.heroRecoverDesc')}
        </p>
        <BenefitList variant="recover" />
      </div>
    );
  }

  if (variant === 'register') {
    return (
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-exchange-yellow/10 border border-exchange-yellow/30 mb-6">
          <Zap size={14} className="text-exchange-yellow" />
          <span className="text-xs font-semibold text-exchange-yellow tracking-wide">
            {t('auth.heroRegisterBadge')}
          </span>
        </div>
        <h2 className="text-4xl xl:text-5xl font-extrabold text-exchange-text leading-[1.12] mb-5">
          {t('auth.heroRegisterTitleA')}
          <br />
          <span className="bg-gradient-to-r from-exchange-yellow to-[#f7ce45] bg-clip-text text-transparent">
            {t('auth.heroRegisterTitleB')}
          </span>
        </h2>
        <p className="text-[15px] text-exchange-text-secondary leading-relaxed mb-10 max-w-[480px]">
          {t('auth.heroRegisterDesc')}
        </p>
        <BenefitList variant="register" />
      </div>
    );
  }

  // login
  return (
    <div>
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-exchange-buy/10 border border-exchange-buy/30 mb-6">
        <TrendingUp size={14} className="text-exchange-buy" />
        <span className="text-xs font-semibold text-exchange-buy tracking-wide">
          {t('auth.heroLoginBadge')}
        </span>
      </div>
      <h2 className="text-4xl xl:text-5xl font-extrabold text-exchange-text leading-[1.12] mb-5">
        {t('auth.heroLoginTitleA')}
        <br />
        <span className="bg-gradient-to-r from-exchange-yellow to-[#f7ce45] bg-clip-text text-transparent">
          {t('auth.heroLoginTitleB')}
        </span>
      </h2>
      <p className="text-[15px] text-exchange-text-secondary leading-relaxed mb-10 max-w-[480px]">
        {t('auth.heroLoginDesc')}
      </p>
      <BenefitList variant="login" />
    </div>
  );
}

// ============================================================================
// Benefit bullet list (icon + title + sub)
// ============================================================================
function BenefitList({ variant }: { variant: 'login' | 'register' | 'recover' }) {
  const { t } = useI18n();

  const items =
    variant === 'register'
      ? [
          {
            icon: <Zap size={18} className="text-exchange-yellow" />,
            title: t('auth.heroBenefit1Title'),
            sub: t('auth.heroBenefit1Sub'),
          },
          {
            icon: <ShieldCheck size={18} className="text-exchange-buy" />,
            title: t('auth.heroBenefit2Title'),
            sub: t('auth.heroBenefit2Sub'),
          },
          {
            icon: <TrendingUp size={18} className="text-[#3b82f6]" />,
            title: t('auth.heroBenefit3Title'),
            sub: t('auth.heroBenefit3Sub'),
          },
        ]
      : variant === 'recover'
      ? [
          {
            icon: <ShieldCheck size={18} className="text-exchange-buy" />,
            title: t('auth.heroRecoverBenefit1Title'),
            sub: t('auth.heroRecoverBenefit1Sub'),
          },
          {
            icon: <Zap size={18} className="text-exchange-yellow" />,
            title: t('auth.heroRecoverBenefit2Title'),
            sub: t('auth.heroRecoverBenefit2Sub'),
          },
        ]
      : [
          {
            icon: <TrendingUp size={18} className="text-exchange-buy" />,
            title: t('auth.heroLoginBenefit1Title'),
            sub: t('auth.heroLoginBenefit1Sub'),
          },
          {
            icon: <ShieldCheck size={18} className="text-exchange-yellow" />,
            title: t('auth.heroLoginBenefit2Title'),
            sub: t('auth.heroLoginBenefit2Sub'),
          },
          {
            icon: <Zap size={18} className="text-[#3b82f6]" />,
            title: t('auth.heroLoginBenefit3Title'),
            sub: t('auth.heroLoginBenefit3Sub'),
          },
        ];

  return (
    <ul className="space-y-4">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-3.5">
          <div
            className="w-10 h-10 rounded-xl bg-exchange-card border border-exchange-border/60
                       flex items-center justify-center shrink-0"
          >
            {it.icon}
          </div>
          <div>
            <div className="text-[15px] font-semibold text-exchange-text leading-snug">
              {it.title}
            </div>
            <div className="text-[13px] text-exchange-text-secondary mt-0.5 leading-relaxed">
              {it.sub}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
