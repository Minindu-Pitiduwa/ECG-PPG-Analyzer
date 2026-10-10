import { useEffect, useRef } from 'react';
import { decimateMinMax, extent } from '@/dsp/util/decimate';
import type { Recording } from '@/io/types';
import { formatTime } from '@/lib/format';
import { useThemeStore } from '@/store/theme';
import { useViewStore } from '@/store/view';
import { readPlotColors } from './colors';

const HEIGHT = 48;

interface MinimapProps {
  recording: Recording;
}

/**
 * A thumbnail of the whole recording with the visible window highlighted.
 * Click or drag to move the window; it also works as a keyboard slider.
 */
export function Minimap({ recording }: MinimapProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useThemeStore((state) => state.theme);
  const { min, max, duration } = useViewStore();
  const { samples, fs } = recording;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!wrapper || !canvas || !context) return;

    const draw = () => {
      const width = wrapper.clientWidth;
      const ratio = devicePixelRatio;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(HEIGHT * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, HEIGHT);

      const { t, y } = decimateMinMax(samples, fs, 0, samples.length, Math.max(1, width));
      const [lo, hi] = extent(y);
      const range = hi - lo || 1;
      const totalS = samples.length / fs;

      context.strokeStyle = readPlotColors().signal;
      context.lineWidth = 1;
      context.globalAlpha = 0.8;
      context.beginPath();
      for (let i = 0; i < t.length; i++) {
        const px = (t[i] / totalS) * width;
        const py = HEIGHT - 3 - ((y[i] - lo) / range) * (HEIGHT - 6);
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.stroke();
    };

    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(wrapper);
    draw();
    return () => resizeObserver.disconnect();
  }, [samples, fs, theme]);

  const centerOn = (clientX: number) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const view = useViewStore.getState();
    const half = (view.max - view.min) / 2;
    const time = ((clientX - rect.left) / rect.width) * view.duration;
    view.setView(time - half, time + half);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const view = useViewStore.getState();
    const span = view.max - view.min;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => view.pan(-span / 2),
      ArrowRight: () => view.pan(span / 2),
      Home: () => view.setView(0, span),
      End: () => view.setView(view.duration - span, view.duration),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const percent = (seconds: number) => (duration > 0 ? (100 * seconds) / duration : 0);

  return (
    <div
      ref={wrapperRef}
      role="slider"
      tabIndex={0}
      aria-label="Position in recording"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round((min + max) / 2)}
      aria-valuetext={`Showing ${formatTime(min)} to ${formatTime(max)}`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        centerOn(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) centerOn(event.clientX);
      }}
      className="bg-muted relative cursor-pointer touch-none overflow-hidden rounded-md"
      style={{ height: HEIGHT }}
      data-testid="minimap"
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />
      <div
        className="border-primary bg-primary/15 pointer-events-none absolute inset-y-0 rounded-sm border"
        // A minimum width keeps the window visible when zoomed far into a long recording.
        style={{ left: `${percent(min)}%`, width: `max(${percent(max - min)}%, 4px)` }}
      />
    </div>
  );
}
