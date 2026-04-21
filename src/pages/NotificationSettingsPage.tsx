import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import {
  Bell, Volume2, VolumeX, Monitor, ChevronLeft, TrendingUp,
  ArrowDownLeft, ArrowUpRight, DollarSign, Info, CheckCircle2,
  AlertCircle, Play,
} from 'lucide-react';
import {
  loadPrefs, savePrefs, NotifPrefs,
  playNotificationSound, requestDesktopPermission, showDesktopNotification,
} from '../utils/notificationPrefs';
import { showToast } from '../components/common/Toast';

type NotifType = keyof NotifPrefs['typeFilters'];

const typeMeta: Record<NotifType, { icon: any; color: string; bg: string }> = {
  order_filled: { icon: TrendingUp,    color: 'text-exchange-yellow', bg: 'bg-exchange-yellow/10' },
  deposit:      { icon: ArrowDownLeft, color: 'text-exchange-buy',    bg: 'bg-exchange-buy/10' },
  withdraw:     { icon: ArrowUpRight,  color: 'text-exchange-sell',   bg: 'bg-exchange-sell/10' },
  system:       { icon: Info,          color: 'text-blue-400',        bg: 'bg-blue-500/10' },
  price:        { icon: DollarSign,    color: 'text-purple-400',      bg: 'bg-purple-500/10' },
};

export default function NotificationSettingsPage() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<NotifPrefs>(loadPrefs());
  const [desktopPermission, setDesktopPermission] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  const toggleSound = () => {
    const next = { ...prefs, soundEnabled: !prefs.soundEnabled };
    setPrefs(next);
    if (next.soundEnabled) playNotificationSound('default');
  };

  const toggleDesktop = async () => {
    if (!prefs.desktopEnabled) {
      const granted = await requestDesktopPermission();
      setDesktopPermission(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
      if (granted) {
        setPrefs({ ...prefs, desktopEnabled: true });
        showDesktopNotification(t('notifSettings.testDesktopTitle'), t('notifSettings.testDesktopBody'));
      } else {
        showToast('warning', t('notifSettings.permissionDenied'), t('notifSettings.permissionDeniedDesc'));
      }
    } else {
      setPrefs({ ...prefs, desktopEnabled: false });
    }
  };

  const toggleType = (type: NotifType) => {
    setPrefs({
      ...prefs,
      typeFilters: { ...prefs.typeFilters, [type]: !prefs.typeFilters[type] },
    });
  };

  const testToast = (type: NotifType) => {
    const map: Record<NotifType, string> = {
      order_filled: 'trade',
      deposit: 'deposit',
      withdraw: 'withdraw',
      system: 'info',
      price: 'price',
    };
    showToast(
      map[type] as any,
      t(`notifSettings.type_${type}`),
      t('notifSettings.testMessage'),
      { duration: 4000, groupKey: `test-${type}`, action: { label: t('common.view'), href: '/notifications' } }
    );
    if (prefs.soundEnabled) playNotificationSound(type);
  };

  const types: NotifType[] = ['order_filled', 'deposit', 'withdraw', 'price', 'system'];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Back */}
      <Link to="/profile" className="inline-flex items-center gap-1 text-sm text-exchange-text-third hover:text-exchange-text mb-4">
        <ChevronLeft size={16} /> {t('common.back')}
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-exchange-yellow/10 rounded-xl flex items-center justify-center">
          <Bell size={20} className="text-exchange-yellow" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-exchange-text">{t('notifSettings.title')}</h1>
          <p className="text-xs text-exchange-text-secondary">{t('notifSettings.subtitle')}</p>
        </div>
      </div>

      {/* Delivery options */}
      <div className="bg-exchange-card rounded-xl border border-exchange-border overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-exchange-border/50">
          <h2 className="text-sm font-semibold text-exchange-text">{t('notifSettings.delivery')}</h2>
        </div>

        {/* Sound */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-exchange-border/30">
          <div className={`w-9 h-9 ${prefs.soundEnabled ? 'bg-exchange-yellow/10' : 'bg-exchange-hover/50'} rounded-lg flex items-center justify-center`}>
            {prefs.soundEnabled
              ? <Volume2 size={17} className="text-exchange-yellow" />
              : <VolumeX size={17} className="text-exchange-text-third" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-exchange-text">{t('notifSettings.sound')}</div>
            <div className="text-[11px] text-exchange-text-third">{t('notifSettings.soundDesc')}</div>
          </div>
          <button
            onClick={() => playNotificationSound('default')}
            className="text-xs text-exchange-text-third hover:text-exchange-yellow p-1.5 rounded-lg hover:bg-exchange-hover/50"
            aria-label="Test"
            title={t('notifSettings.test')}
          >
            <Play size={13} />
          </button>
          <Toggle on={prefs.soundEnabled} onChange={toggleSound} />
        </div>

        {/* Desktop */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className={`w-9 h-9 ${prefs.desktopEnabled ? 'bg-exchange-yellow/10' : 'bg-exchange-hover/50'} rounded-lg flex items-center justify-center`}>
            <Monitor size={17} className={prefs.desktopEnabled ? 'text-exchange-yellow' : 'text-exchange-text-third'} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-exchange-text">{t('notifSettings.desktop')}</div>
            <div className="text-[11px] text-exchange-text-third">
              {desktopPermission === 'denied'
                ? t('notifSettings.permissionDenied')
                : desktopPermission === 'unsupported'
                ? t('notifSettings.unsupported')
                : t('notifSettings.desktopDesc')}
            </div>
          </div>
          {desktopPermission === 'granted' && (
            <span className="inline-flex items-center gap-1 text-[10px] text-exchange-buy mr-2">
              <CheckCircle2 size={10} /> {t('notifSettings.granted')}
            </span>
          )}
          <Toggle
            on={prefs.desktopEnabled}
            onChange={toggleDesktop}
            disabled={desktopPermission === 'denied' || desktopPermission === 'unsupported'}
          />
        </div>
      </div>

      {/* Types */}
      <div className="bg-exchange-card rounded-xl border border-exchange-border overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-exchange-border/50">
          <h2 className="text-sm font-semibold text-exchange-text">{t('notifSettings.types')}</h2>
          <p className="text-[11px] text-exchange-text-third mt-0.5">{t('notifSettings.typesDesc')}</p>
        </div>
        {types.map((type) => {
          const meta = typeMeta[type];
          const Icon = meta.icon;
          return (
            <div key={type} className="flex items-center gap-3 px-4 py-3 border-b border-exchange-border/30 last:border-b-0">
              <div className={`w-9 h-9 ${meta.bg} rounded-lg flex items-center justify-center`}>
                <Icon size={17} className={meta.color} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-exchange-text">{t(`notifSettings.type_${type}`)}</div>
                <div className="text-[11px] text-exchange-text-third">{t(`notifSettings.type_${type}_desc`)}</div>
              </div>
              <button
                onClick={() => testToast(type)}
                className="text-[10px] text-exchange-text-third hover:text-exchange-yellow px-2 py-1 rounded-md hover:bg-exchange-hover/50"
              >
                {t('notifSettings.test')}
              </button>
              <Toggle on={prefs.typeFilters[type]} onChange={() => toggleType(type)} />
            </div>
          );
        })}
      </div>

      {/* Quick links */}
      <div className="bg-exchange-card rounded-xl border border-exchange-border overflow-hidden">
        <Link
          to="/notifications"
          className="flex items-center gap-3 px-4 py-3.5 hover:bg-exchange-hover/30 border-b border-exchange-border/30 transition-colors"
        >
          <div className="w-9 h-9 bg-exchange-hover/50 rounded-lg flex items-center justify-center">
            <Bell size={17} className="text-exchange-text-secondary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-exchange-text">{t('notif.title')}</div>
            <div className="text-[11px] text-exchange-text-third">{t('notifSettings.viewAllDesc')}</div>
          </div>
        </Link>
        <Link
          to="/profile/price-alerts"
          className="flex items-center gap-3 px-4 py-3.5 hover:bg-exchange-hover/30 transition-colors"
        >
          <div className="w-9 h-9 bg-purple-500/10 rounded-lg flex items-center justify-center">
            <DollarSign size={17} className="text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-exchange-text">{t('priceAlert.title')}</div>
            <div className="text-[11px] text-exchange-text-third">{t('priceAlert.subtitle')}</div>
          </div>
        </Link>
      </div>

      {/* Info */}
      <div className="mt-4 flex items-start gap-2 px-4 py-3 bg-blue-500/5 border border-blue-400/20 rounded-lg">
        <AlertCircle size={14} className="text-blue-400 mt-0.5 shrink-0" />
        <p className="text-[11px] text-exchange-text-secondary leading-relaxed">
          {t('notifSettings.localOnlyNote')}
        </p>
      </div>
    </div>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors
        ${on ? 'bg-exchange-yellow' : 'bg-exchange-hover'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
          ${on ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  );
}
