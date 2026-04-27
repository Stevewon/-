import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';
import api from '../../utils/api';

interface Props {
  symbol: string;
}

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

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
      rightPriceScale: {
        borderColor: '#2B3139',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#2B3139',
        timeVisible: true,
        secondsVisible: false,
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
