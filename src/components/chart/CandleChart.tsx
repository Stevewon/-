import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';
import api from '../../utils/api';

interface Props {
  symbol: string;
}

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

// ----------------------------------------------------------------------------
// Korea Standard Time (KST, UTC+9) display helpers.
// ----------------------------------------------------------------------------
// lightweight-charts renders the time axis in UTC by default. Our candle
// `time` values are Unix seconds (UTC). Rather than mutating the underlying
// data (which would corrupt the real candle open-times), we format the axis
// tick marks and the crosshair tooltip into KST here. `Intl` with the fixed
// 'Asia/Seoul' zone is DST-safe (Korea has no DST) and consistent regardless
// of the viewer's own browser timezone.
const KST_ZONE = 'Asia/Seoul';
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

function kstParts(unixSec: number) {
  const d = new Date(unixSec * 1000);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: KST_ZONE,
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(d).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  return parts; // { year, month, day, hour, minute }
}

// Axis tick labels. For intraday intervals show HH:MM (KST); for daily+ show
// the date. lightweight-charts passes the tickmark `time` (Unix seconds here).
function makeTickMarkFormatter(interval: string) {
  const intraday = /m|h/.test(interval); // 1m/5m/15m/1h/4h
  return (time: number) => {
    const p = kstParts(typeof time === 'number' ? time : Number(time));
    if (intraday) return `${p.hour}:${p.minute}`;
    return `${p.day} ${p.month}`;
  };
}

// Crosshair tooltip time — always full date + HH:MM in KST, with a KST tag so
// it's unambiguous.
function kstCrosshairFormatter(time: number) {
  const p = kstParts(typeof time === 'number' ? time : Number(time));
  return `${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute} (KST)`;
}

export default function CandleChart({ symbol }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const [interval, setIntervalState] = useState('1h');

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = createChart(chartRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0B0E11' },
        textColor: '#848E9C',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1E2329' },
        horzLines: { color: '#1E2329' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      // Display all time labels in Korea Standard Time (KST, UTC+9).
      localization: {
        timeFormatter: kstCrosshairFormatter,
      },
      rightPriceScale: {
        borderColor: '#2B3139',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#2B3139',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: makeTickMarkFormatter('1h'),
      },
      handleScroll: { vertTouchDrag: false },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#0ECB81',
      downColor: '#F6465D',
      borderUpColor: '#0ECB81',
      borderDownColor: '#F6465D',
      wickUpColor: '#0ECB81',
      wickDownColor: '#F6465D',
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartInstance.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (chartRef.current) {
        chart.applyOptions({
          width: chartRef.current.clientWidth,
          height: chartRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Keep the KST axis tick formatting appropriate for the current interval
  // (HH:MM for intraday, DD Mon for daily+).
  useEffect(() => {
    chartInstance.current?.timeScale().applyOptions({
      tickMarkFormatter: makeTickMarkFormatter(interval),
    });
  }, [interval]);

  useEffect(() => {
    loadCandles();

    // Poll for candle updates (SSE-compatible, no WebSocket needed)
    // CRITICAL: use window.setInterval — `setInterval` was shadowed by useState setter
    const pollInterval = window.setInterval(() => {
      refreshLatestCandle();
    }, 5000);

    return () => window.clearInterval(pollInterval);
  }, [symbol, interval]);

  const refreshLatestCandle = useCallback(async () => {
    try {
      const res = await api.get(`/market/candles/${symbol}?interval=${interval}&limit=2`);
      if (res.data && res.data.length > 0) {
        const latest = res.data[0];
        candleSeriesRef.current?.update({
          time: latest.time,
          open: latest.open,
          high: latest.high,
          low: latest.low,
          close: latest.close,
        });
        volumeSeriesRef.current?.update({
          time: latest.time,
          value: latest.volume,
          color: latest.close >= latest.open ? 'rgba(14,203,129,0.3)' : 'rgba(246,70,93,0.3)',
        });
      }
    } catch {}
  }, [symbol, interval]);

  const loadCandles = async () => {
    try {
      const res = await api.get(`/market/candles/${symbol}?interval=${interval}&limit=300`);
      const candles = res.data.map((c: any) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      const volumes = res.data.map((c: any) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(14,203,129,0.3)' : 'rgba(246,70,93,0.3)',
      }));

      // Pick a price precision that actually shows sub-cent coins (e.g. QTA at
      // ~0.004998). Without this the candlestick series defaults to 2 decimals
      // / minMove 0.01, so the axis + crosshair tooltip render every value as
      // "0.00". Derive decimals from the smallest non-zero close in the set.
      const prices = res.data
        .map((c: any) => Math.abs(Number(c.close)))
        .filter((v: number) => v > 0);
      const minPrice = prices.length ? Math.min(...prices) : 1;
      let precision = 2;
      if (minPrice < 1) {
        // number of leading zeros after the decimal point + 4 significant digits
        const leadingZeros = Math.floor(-Math.log10(minPrice));
        precision = Math.min(8, Math.max(2, leadingZeros + 4));
      }
      const minMove = Math.pow(10, -precision);
      candleSeriesRef.current?.applyOptions({
        priceFormat: { type: 'price', precision, minMove },
      });

      candleSeriesRef.current?.setData(candles);
      volumeSeriesRef.current?.setData(volumes);
      chartInstance.current?.timeScale().fitContent();
    } catch (e) {
      console.error('Failed to load candles:', e);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-exchange-border">
        {INTERVALS.map((iv) => (
          <button
            key={iv}
            onClick={() => setIntervalState(iv)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              interval === iv
                ? 'bg-exchange-yellow/20 text-exchange-yellow'
                : 'text-exchange-text-secondary hover:text-exchange-text'
            }`}
          >
            {iv}
          </button>
        ))}
      </div>
      <div ref={chartRef} className="flex-1 min-h-0" />
    </div>
  );
}
