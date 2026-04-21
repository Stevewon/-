import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import QuantaLogo from './QuantaLogo';
import LangSwitch from './LangSwitch';
import { Globe, Moon } from 'lucide-react';

// ===== Social Icon Components =====
function IconDiscord({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.11 13.11 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z"/></svg>;
}
function IconTelegram({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>;
}
function IconX({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>;
}
function IconReddit({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.11 3.11 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 00.029-.463.33.33 0 00-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.232-.095z"/></svg>;
}
function IconYoutube({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>;
}
function IconInstagram({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227a3.81 3.81 0 01-.899 1.382 3.744 3.744 0 01-1.38.896c-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421a3.716 3.716 0 01-1.379-.899 3.644 3.644 0 01-.9-1.38c-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 100 12.324 6.162 6.162 0 100-12.324zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405a1.441 1.441 0 11-2.882 0 1.441 1.441 0 012.882 0z"/></svg>;
}
function IconFacebook({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>;
}
function IconTikTok({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>;
}
function IconMedium({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M13.54 12a6.8 6.8 0 01-6.77 6.82A6.8 6.8 0 010 12a6.8 6.8 0 016.77-6.82A6.8 6.8 0 0113.54 12zM20.96 12c0 3.54-1.51 6.42-3.38 6.42-1.87 0-3.39-2.88-3.39-6.42s1.52-6.42 3.39-6.42 3.38 2.88 3.38 6.42M24 12c0 3.17-.53 5.75-1.19 5.75-.66 0-1.19-2.58-1.19-5.75s.53-5.75 1.19-5.75C23.47 6.25 24 8.83 24 12z"/></svg>;
}
function IconKakao({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c5.799 0 10.5 3.664 10.5 8.185 0 4.52-4.701 8.184-10.5 8.184a13.5 13.5 0 01-1.727-.11l-4.408 2.883c-.501.265-.678.236-.472-.413l.892-3.678c-2.88-1.46-4.785-3.99-4.785-6.866C1.5 6.665 6.201 3 12 3zm5.907 8.06l1.47-1.424a.472.472 0 00-.656-.678l-1.928 1.866V9.282a.472.472 0 00-.944 0v2.557a.471.471 0 000 .222v2.218a.472.472 0 00.944 0v-1.58h.378l1.982 1.986a.472.472 0 00.668-.668l-1.914-1.957zm-9.14-1.727a.472.472 0 00-.472.472v1.287l-1.891-1.91a.472.472 0 00-.667.667l2.531 2.554a.469.469 0 00.5.086.472.472 0 00.472-.472v-3.684a.472.472 0 00-.472-.472v1z"/></svg>;
}

// ===== Footer Link Component =====
function FooterLink({ label, to, href, highlight }: { label: string; to?: string; href?: string; highlight?: boolean }) {
  const cls = `text-[12px] sm:text-[13px] lg:text-sm leading-snug hover:text-exchange-text transition-colors ${
    highlight ? 'text-exchange-yellow' : 'text-exchange-text-secondary'
  }`;
  if (to) return <Link to={to} className={cls}>{label}</Link>;
  return <a href={href || '#'} className={cls} target={href && href !== '#' ? '_blank' : undefined} rel="noopener noreferrer">{label}</a>;
}

// ===== Main Footer =====
export default function Footer() {
  const { t } = useI18n();

  const socialLinks = [
    { icon: IconDiscord, label: 'Discord' },
    { icon: IconTelegram, label: 'Telegram' },
    { icon: IconTikTok, label: 'TikTok' },
    { icon: IconFacebook, label: 'Facebook' },
    { icon: IconX, label: 'X' },
    { icon: IconReddit, label: 'Reddit' },
    { icon: IconInstagram, label: 'Instagram' },
    { icon: IconMedium, label: 'Medium' },
    { icon: IconYoutube, label: 'YouTube' },
    { icon: IconKakao, label: 'KakaoTalk' },
  ];

  const aboutLinks = [
    { label: t('footer.about'), to: '/home' },
    { label: t('footer.careers'), href: '#' },
    { label: t('footer.notice'), to: '/notice' },
    { label: t('footer.press'), href: '#' },
    { label: t('footer.terms'), to: '/terms' },
    { label: t('footer.privacy'), to: '/privacy' },
    { label: t('footer.blog'), href: '#' },
    { label: t('footer.riskWarning'), href: '#' },
  ];

  const productLinks = [
    { label: t('footer.exchange'), to: '/trade/BTC-USDT', highlight: true },
    { label: t('nav.markets'), to: '/markets' },
    { label: t('footer.fee'), to: '/fee' },
    { label: t('footer.academy'), href: '#' },
    { label: t('footer.airdrop'), href: '#' },
    { label: t('footer.ethStaking'), href: '#' },
    { label: t('footer.qtaStaking'), href: '#' },
  ];

  const buyLinks = [
    { label: t('footer.buyBitcoin'), to: '/trade/BTC-USDT' },
    { label: t('footer.buyEthereum'), to: '/trade/ETH-USDT' },
    { label: t('footer.buyXrp'), to: '/trade/XRP-USDT' },
    { label: t('footer.buySolana'), to: '/trade/SOL-USDT' },
    { label: t('footer.qtaToken'), href: '#' },
    { label: t('footer.buyAltcoins'), to: '/markets' },
  ];

  const serviceLinks = [
    { label: t('footer.affiliate'), href: '#' },
    { label: t('footer.referral'), href: '#' },
    { label: t('footer.otcTrading'), href: '#' },
    { label: t('footer.historicalData'), href: '#' },
    { label: t('footer.proofOfReserves'), href: '#' },
  ];

  const supportLinks = [
    { label: t('footer.chat247'), to: '/support' },
    { label: t('footer.supportCenter'), to: '/support' },
    { label: t('footer.fee'), to: '/fee' },
    { label: t('footer.api'), href: '#' },
    { label: t('footer.complaints'), href: '#' },
  ];

  return (
    <footer className="bg-[#0B0E11] border-t border-exchange-border mt-auto">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 sm:pt-10 lg:pt-14 pb-6 sm:pb-8">

        {/* ===== MOBILE FOOTER (< md) ===== */}
        <div className="md:hidden">
          <div className="flex items-center gap-2 flex-wrap mb-6">
            {socialLinks.map(({ icon: Icon, label }) => (
              <a key={label} href="#" className="w-8 h-8 rounded-full bg-exchange-hover/60 flex items-center justify-center text-exchange-text-secondary hover:text-exchange-text transition-colors">
                <Icon size={14} />
              </a>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-5 mb-6">
            <div>
              <h4 className="text-xs font-semibold text-exchange-text mb-2.5">{t('footer.aboutUs')}</h4>
              <div className="flex flex-col gap-2">
                {aboutLinks.slice(0, 5).map((l, i) => <FooterLink key={i} {...l} />)}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-exchange-text mb-2.5">{t('footer.products')}</h4>
              <div className="flex flex-col gap-2">
                {productLinks.map((l, i) => <FooterLink key={i} {...l} />)}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-exchange-text mb-2.5">{t('footer.buyCrypto')}</h4>
              <div className="flex flex-col gap-2">
                {buyLinks.map((l, i) => <FooterLink key={i} {...l} />)}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-exchange-text mb-2.5">{t('footer.support')}</h4>
              <div className="flex flex-col gap-2">
                {supportLinks.map((l, i) => <FooterLink key={i} {...l} />)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-4 pt-4 border-t border-exchange-border/50">
            <LangSwitch />
            <span className="text-[10px] text-exchange-text-third">KRW / USD</span>
            <span className="ml-auto"><Moon size={12} className="text-exchange-text-third" /></span>
          </div>

          <div className="flex items-center gap-2">
            <QuantaLogo size={18} showText={false} />
            <p className="text-[10px] text-exchange-text-third leading-relaxed">
              &copy; 2026 {t('footer.copyright')}
            </p>
          </div>
        </div>

        {/* ===== DESKTOP FOOTER (>= md) ===== */}
        <div className="hidden md:block">
          <div className="grid grid-cols-12 gap-6 lg:gap-10">

            <div className="col-span-2">
              <h4 className="text-sm font-bold text-exchange-text mb-5">{t('footer.community')}</h4>
              <div className="grid grid-cols-5 gap-2 mb-6">
                {socialLinks.map(({ icon: Icon, label }) => (
                  <a key={label} href="#" target="_blank" rel="noopener noreferrer"
                    className="w-9 h-9 rounded-full bg-exchange-hover/60 flex items-center justify-center text-exchange-text-secondary hover:text-exchange-text hover:bg-exchange-hover transition-all" title={label}>
                    <Icon size={15} />
                  </a>
                ))}
              </div>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <Globe size={13} className="text-exchange-text-third" />
                  <LangSwitch />
                </div>
                <div className="flex items-center gap-2 text-xs text-exchange-text-secondary">
                  <Globe size={13} className="text-exchange-text-third" />
                  <span>KRW / USD</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-exchange-text-secondary">
                  <Moon size={13} className="text-exchange-text-third" />
                  <span>{t('footer.darkMode')}</span>
                </div>
              </div>
            </div>

            <div className="col-span-2">
              <h4 className="text-sm font-bold text-exchange-text mb-5">{t('footer.aboutUs')}</h4>
              <div className="flex flex-col gap-[11px]">
                {aboutLinks.map((l, i) => <FooterLink key={i} {...l} />)}
              </div>
            </div>

            <div className="col-span-2">
              <h4 className="text-sm font-bold text-exchange-text mb-5">{t('footer.products')}</h4>
              <div className="flex flex-col gap-[11px]">
                {productLinks.map((l, i) => <FooterLink key={i} {...l} />)}
              </div>
            </div>

            <div className="col-span-3">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-bold text-exchange-text mb-5">{t('footer.buyCrypto')}</h4>
                  <div className="flex flex-col gap-[11px]">
                    {buyLinks.map((l, i) => <FooterLink key={i} {...l} />)}
                  </div>
                  <h4 className="text-sm font-bold text-exchange-text mt-6 mb-5">{t('footer.service')}</h4>
                  <div className="flex flex-col gap-[11px]">
                    {serviceLinks.map((l, i) => <FooterLink key={i} {...l} />)}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-exchange-text mb-5">{t('footer.support')}</h4>
                  <div className="flex flex-col gap-[11px]">
                    {supportLinks.map((l, i) => <FooterLink key={i} {...l} />)}
                  </div>
                </div>
              </div>
            </div>

            <div className="col-span-1 flex flex-col items-center">
              <div className="w-16 h-16 lg:w-[72px] lg:h-[72px] bg-exchange-hover/40 rounded-lg flex items-center justify-center mb-2">
                <svg width="36" height="36" viewBox="0 0 40 40" fill="none" className="text-exchange-text-third">
                  <rect x="4" y="4" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  <rect x="24" y="4" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  <rect x="4" y="24" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  <rect x="8" y="8" width="4" height="4" fill="currentColor" />
                  <rect x="28" y="8" width="4" height="4" fill="currentColor" />
                  <rect x="8" y="28" width="4" height="4" fill="currentColor" />
                  <rect x="24" y="24" width="4" height="4" fill="currentColor" />
                  <rect x="30" y="30" width="6" height="6" rx="1" fill="currentColor" />
                </svg>
              </div>
              <span className="text-[10px] text-exchange-text-third text-center leading-tight">{t('footer.downloadApp')}</span>
            </div>
          </div>

          <div className="border-t border-exchange-border mt-10 pt-6 flex items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <QuantaLogo size={20} showText={true} />
            </div>
            <p className="text-[11px] text-exchange-text-third text-right leading-relaxed">
              &copy; 2026 {t('footer.copyright')}
              <span className="mx-1.5 text-exchange-border">|</span>
              {t('footer.disclaimer')}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
