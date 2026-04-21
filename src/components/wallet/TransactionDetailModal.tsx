import { X, Copy, CheckCircle2, Clock, XCircle, ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react';
import { useI18n } from '../../i18n';
import CoinIcon from '../common/CoinIcon';
import { showToast } from '../common/Toast';
import { formatAmount } from '../../utils/format';

interface Transaction {
  id: string;
  coin_symbol: string;
  amount: number;
  fee?: number;
  address?: string;
  status: string;
  tx_hash?: string;
  created_at: string;
  network?: string;
  memo?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  transaction: Transaction | null;
  type: 'deposit' | 'withdrawal';
}

export default function TransactionDetailModal({ open, onClose, transaction, type }: Props) {
  const { t } = useI18n();

  if (!open || !transaction) return null;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('success', t('wallet.copied'), label);
    } catch {
      showToast('error', t('wallet.copyFailed'));
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return { color: 'bg-exchange-buy/10 text-exchange-buy border-exchange-buy/20', icon: CheckCircle2, label: t('status.completed') };
      case 'pending':
        return { color: 'bg-exchange-yellow/10 text-exchange-yellow border-exchange-yellow/20', icon: Clock, label: t('status.processing') };
      case 'failed':
      case 'rejected':
        return { color: 'bg-exchange-sell/10 text-exchange-sell border-exchange-sell/20', icon: XCircle, label: t('status.failed') };
      default:
        return { color: 'bg-exchange-hover/40 text-exchange-text-secondary border-exchange-border', icon: Clock, label: status };
    }
  };

  const badge = statusBadge(transaction.status);
  const isDeposit = type === 'deposit';

  const formatDate = (s: string) => {
    try {
      const d = new Date(s);
      return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    } catch { return s; }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-exchange-card border border-exchange-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-exchange-border">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDeposit ? 'bg-exchange-buy/10' : 'bg-exchange-sell/10'}`}>
              {isDeposit
                ? <ArrowDownLeft size={18} className="text-exchange-buy" />
                : <ArrowUpRight size={18} className="text-exchange-sell" />}
            </div>
            <h2 className="text-lg font-semibold text-exchange-text">
              {isDeposit ? t('wallet.depositDetails') : t('wallet.withdrawDetails')}
            </h2>
          </div>
          <button onClick={onClose} className="text-exchange-text-third hover:text-exchange-text p-1">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Amount */}
          <div className="text-center bg-exchange-bg/50 rounded-xl border border-exchange-border/50 p-4">
            <div className="flex items-center justify-center gap-2 mb-1">
              <CoinIcon symbol={transaction.coin_symbol} size={24} />
              <span className="text-sm text-exchange-text-third">{transaction.coin_symbol}</span>
            </div>
            <div className={`text-2xl font-bold tabular-nums ${isDeposit ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
              {isDeposit ? '+' : '-'}{formatAmount(transaction.amount)}
            </div>
            <div className={`inline-flex items-center gap-1 text-xs font-medium mt-2 px-2 py-1 rounded-full border ${badge.color}`}>
              <badge.icon size={12} />
              {badge.label}
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-3 text-xs">
            <Row label={t('wallet.txid') || 'Transaction ID'} value={transaction.id.slice(0, 16) + '...'} onCopy={() => copy(transaction.id, 'Transaction ID')} mono />

            {transaction.tx_hash && (
              <Row
                label={t('wallet.txHash')}
                value={transaction.tx_hash.slice(0, 18) + '...'}
                onCopy={() => copy(transaction.tx_hash!, 'Tx Hash')}
                mono
                external
              />
            )}

            {transaction.network && (
              <Row label={t('wallet.network')} value={transaction.network} />
            )}

            {transaction.address && (
              <Row
                label={isDeposit ? t('wallet.fromAddress') : t('wallet.toAddress')}
                value={transaction.address.slice(0, 10) + '...' + transaction.address.slice(-8)}
                onCopy={() => copy(transaction.address!, 'Address')}
                mono
              />
            )}

            {transaction.memo && (
              <Row
                label={t('wallet.memo')}
                value={transaction.memo}
                onCopy={() => copy(transaction.memo!, 'Memo')}
                mono
              />
            )}

            <Row label={t('wallet.amount')} value={`${formatAmount(transaction.amount)} ${transaction.coin_symbol}`} />

            {!isDeposit && transaction.fee !== undefined && transaction.fee > 0 && (
              <Row label={t('wallet.networkFee')} value={`${formatAmount(transaction.fee)} ${transaction.coin_symbol}`} />
            )}

            <Row label={t('wallet.dateTime')} value={formatDate(transaction.created_at)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  onCopy,
  mono,
  external,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  mono?: boolean;
  external?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-exchange-text-third shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`text-exchange-text truncate ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</span>
        {onCopy && (
          <button
            onClick={onCopy}
            className="text-exchange-text-third hover:text-exchange-yellow transition-colors shrink-0 p-0.5"
          >
            <Copy size={12} />
          </button>
        )}
        {external && (
          <span className="text-exchange-text-third shrink-0"><ExternalLink size={12} /></span>
        )}
      </div>
    </div>
  );
}
