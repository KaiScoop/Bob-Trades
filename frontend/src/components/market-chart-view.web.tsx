import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText as Text } from '@/components/app-text';
import {
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';

import { AppColors } from '@/constants/theme';
import type { MarketCandle } from '@/lib/api';

type MarketChartViewProps = {
  symbol: string;
  timeframe: string;
  candles: MarketCandle[];
  fitContentKey: number;
  loading: boolean;
  unavailable: boolean;
};

export default function MarketChartView({ symbol, timeframe, candles, fitContentKey, loading, unavailable }: MarketChartViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const renderedKeyRef = useRef('');
  const lastTimeRef = useRef<number | null>(null);
  const chartKey = `${symbol}:${timeframe}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      height: 280,
      layout: { background: { type: ColorType.Solid, color: '#0A0A0A' }, textColor: '#A1A1AA', fontFamily: 'system-ui, sans-serif' },
      grid: { vertLines: { color: '#171717' }, horzLines: { color: '#171717' } },
      crosshair: { mode: 1, vertLine: { color: '#71717A', labelBackgroundColor: '#27272A' }, horzLine: { color: '#71717A', labelBackgroundColor: '#27272A' } },
      rightPriceScale: { borderColor: '#27272A', scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: '#27272A', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: AppColors.success,
      downColor: AppColors.danger,
      borderUpColor: AppColors.success,
      borderDownColor: AppColors.danger,
      wickUpColor: AppColors.success,
      wickDownColor: AppColors.danger,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      renderedKeyRef.current = '';
      lastTimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries) return;

    const ordered = [...candles].sort((left, right) => left.ts - right.ts);
    const candleData = ordered.map((candle) => ({
      time: Math.floor(candle.ts / 1000) as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    const volumeData = ordered.map((candle) => ({
      time: Math.floor(candle.ts / 1000) as UTCTimestamp,
      value: candle.volume,
      color: candle.close >= candle.open ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)',
    }));

    if (renderedKeyRef.current !== chartKey || lastTimeRef.current === null || candleData.length === 0) {
      candleSeries.setData(candleData);
      volumeSeries.setData(volumeData);
      renderedKeyRef.current = chartKey;
      lastTimeRef.current = candleData.length ? Number(candleData[candleData.length - 1].time) : null;
      chartRef.current?.timeScale().fitContent();
      return;
    }

    const latest = candleData[candleData.length - 1];
    const latestTime = Number(latest.time);
    if (latestTime >= lastTimeRef.current) {
      candleSeries.update(latest);
      volumeSeries.update(volumeData[volumeData.length - 1]);
      lastTimeRef.current = latestTime;
    } else {
      candleSeries.setData(candleData);
      volumeSeries.setData(volumeData);
      lastTimeRef.current = latestTime;
    }
  }, [candles, chartKey]);

  useEffect(() => {
    chartRef.current?.timeScale().fitContent();
  }, [fitContentKey]);

  const message = loading ? 'Loading chart…' : unavailable && candles.length === 0 ? 'Market history is unavailable.' : null;

  return (
    <View style={styles.chartFrame}>
      <View ref={containerRef as never} style={styles.chart} />
      {message ? <View pointerEvents="none" style={styles.message}><Text style={styles.messageText}>{message}</Text></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chartFrame: { height: 280, position: 'relative' },
  chart: { height: 280, width: '100%' },
  message: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10, 10, 10, 0.72)' },
  messageText: { color: AppColors.muted, fontSize: 12 },
});