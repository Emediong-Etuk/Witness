import { useEffect, useRef } from 'react';

/** devicePixelRatio-aware canvas trace with a fading trail. Display only. */
export function Waveform({ values, color = 'var(--verified)', height = 48, label }: { values: number[]; color?: string; height?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = height;
    if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr);
    if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (values.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (const v of values) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const span = hi - lo || 1;
    const resolved = getComputedStyle(cv).getPropertyValue('--wave-color').trim() || '#7cf2b0';
    g.lineWidth = 1.5;
    g.lineJoin = 'round';
    const n = values.length;
    for (let i = 1; i < n; i++) {
      g.strokeStyle = resolved;
      g.globalAlpha = 0.15 + 0.85 * (i / n);
      g.beginPath();
      g.moveTo(((i - 1) / (n - 1)) * w, h - 4 - ((values[i - 1]! - lo) / span) * (h - 8));
      g.lineTo((i / (n - 1)) * w, h - 4 - ((values[i]! - lo) / span) * (h - 8));
      g.stroke();
    }
    g.globalAlpha = 1;
  }, [values, height]);
  return <canvas ref={ref} role="img" aria-label={label} style={{ width: '100%', height, display: 'block', ['--wave-color' as string]: color }} />;
}
