// Skeleton Loading UI for exchange components

interface Props {
  type: 'orderbook' | 'trades' | 'chart' | 'table' | 'card' | 'ticker';
  rows?: number;
}

function SkeletonPulse({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-exchange-hover/60 rounded ${className}`} />
  );
}

function OrderbookSkeleton() {
  return (
    <div className="flex flex-col h-full text-xs p-2 gap-[2px]">
      {/* Header */}
      <div className="flex justify-between mb-2">
        <SkeletonPulse className="h-3 w-12" />
        <SkeletonPulse className="h-3 w-10" />
        <SkeletonPulse className="h-3 w-12" />
      </div>
      {/* Asks */}
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={`ask-${i}`} className="flex justify-between py-[3px]">
          <SkeletonPulse className="h-3 w-[35%]" />
          <SkeletonPulse className="h-3 w-[25%]" />
          <SkeletonPulse className="h-3 w-[30%]" />
        </div>
      ))}
      {/* Center price */}
      <div className="flex justify-center py-2 my-1">
        <SkeletonPulse className="h-5 w-24" />
      </div>
      {/* Bids */}
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={`bid-${i}`} className="flex justify-between py-[3px]">
          <SkeletonPulse className="h-3 w-[35%]" />
          <SkeletonPulse className="h-3 w-[25%]" />
          <SkeletonPulse className="h-3 w-[30%]" />
        </div>
      ))}
    </div>
  );
}

function TradesSkeleton({ rows = 20 }: { rows?: number }) {
  return (
    <div className="flex flex-col text-xs p-2 gap-[2px]">
      <div className="flex justify-between mb-2">
        <SkeletonPulse className="h-3 w-10" />
        <SkeletonPulse className="h-3 w-10" />
        <SkeletonPulse className="h-3 w-10" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex justify-between py-[3px]">
          <SkeletonPulse className="h-3 w-[30%]" />
          <SkeletonPulse className="h-3 w-[25%]" />
          <SkeletonPulse className="h-3 w-[30%]" />
        </div>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex flex-col h-full p-3">
      {/* Interval buttons */}
      <div className="flex gap-2 mb-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonPulse key={i} className="h-6 w-8" />
        ))}
      </div>
      {/* Chart area */}
      <div className="flex-1 relative">
        <div className="absolute inset-0 flex items-end gap-[2px] pb-8">
          {Array.from({ length: 60 }).map((_, i) => {
            const h = 20 + Math.random() * 60;
            return (
              <div key={i} className="flex-1 flex flex-col justify-end">
                <SkeletonPulse className={`w-full`} style={{ height: `${h}%` }} />
              </div>
            );
          })}
        </div>
        {/* Y-axis labels */}
        <div className="absolute right-0 top-0 bottom-0 w-12 flex flex-col justify-between py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonPulse key={i} className="h-3 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonPulse key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: 6 }).map((_, j) => (
            <SkeletonPulse key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <SkeletonPulse className="h-5 w-1/3" />
      <SkeletonPulse className="h-4 w-full" />
      <SkeletonPulse className="h-4 w-2/3" />
      <div className="flex gap-3 mt-4">
        <SkeletonPulse className="h-8 w-20" />
        <SkeletonPulse className="h-8 w-20" />
      </div>
    </div>
  );
}

function TickerSkeleton() {
  return (
    <div className="flex items-center gap-6 px-4 h-8">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 shrink-0">
          <SkeletonPulse className="h-4 w-4 rounded-full" />
          <SkeletonPulse className="h-3 w-8" />
          <SkeletonPulse className="h-3 w-14" />
          <SkeletonPulse className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

export default function SkeletonLoader({ type, rows }: Props) {
  switch (type) {
    case 'orderbook':
      return <OrderbookSkeleton />;
    case 'trades':
      return <TradesSkeleton rows={rows} />;
    case 'chart':
      return <ChartSkeleton />;
    case 'table':
      return <TableSkeleton rows={rows} />;
    case 'card':
      return <CardSkeleton />;
    case 'ticker':
      return <TickerSkeleton />;
    default:
      return <TableSkeleton />;
  }
}
