import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { SectionHead } from '../components/Reveal';

const MAX = 180; // per minute (3 Hz)

export function Flicker() {
  const [ok, setOk] = useState(false);
  const [perMin, setPerMin] = useState(72);
  const [amp, setAmp] = useState(0.5);
  const [running, setRunning] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const t0 = performance.now();
    let wake: { release(): Promise<void> } | null = null;
    void (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen').then((w) => (wake = w)).catch(() => {});
    void stage.current?.requestFullscreen?.().catch(() => {});
    const frame = (now: number) => {
      const level = 0.5 + 0.5 * amp * Math.sin(2 * Math.PI * (perMin / 60) * ((now - t0) / 1000));
      const v = Math.round(255 * level);
      if (stage.current) stage.current.style.background = `rgb(${v},${v},${v})`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onFs = () => !document.fullscreenElement && setRunning(false);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      cancelAnimationFrame(raf);
      void wake?.release();
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, [running, perMin, amp]);
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <SectionHead eyebrow="Flicker tool" title="Make a room flicker, on purpose.">
        Turns a phone into a lamp whose brightness rises and falls smoothly at a set rate. This reproduces the "flickering illumination" the SmartSpectra model cards warn about (tests F1–F3).
      </SectionHead>
      <div className="card p-6" data-tour="flicker">
        {!ok ? (
          <div role="alertdialog" aria-labelledby="ps-title">
            <h3 id="ps-title" className="text-xl font-medium text-warming">Photosensitivity warning</h3>
            <p className="mt-2 text-sm text-muted">This tool makes the whole screen brighten and dim repeatedly. Don't use it if you or anyone nearby is sensitive to flashing or flickering light. It is capped at {MAX} cycles per minute (3 Hz) and changes brightness smoothly, never in hard flashes.</p>
            <button className="btn btn-primary mt-4" onClick={() => setOk(true)} data-testid="flicker-ok">I understand</button>
          </div>
        ) : (
          <div>
            <div className="flex flex-wrap gap-2">
              {[[72, 'pulse band'], [15, 'breathing band']].map(([r, l]) => (
                <button key={r} onClick={() => setPerMin(r as number)} aria-pressed={perMin === r} className={`chip py-1.5 ${perMin === r ? 'border-ink' : 'text-muted'}`}>{r}/min · {l}</button>
              ))}
              <label className="chip py-1.5 text-muted">custom <input type="number" min={1} max={MAX} value={perMin} onChange={(e) => setPerMin(Math.min(MAX, Math.max(1, Number(e.target.value) || 1)))} className="w-16 bg-transparent text-ink" aria-label="Cycles per minute" /> /min</label>
            </div>
            <label className="mt-5 block text-sm">
              Amplitude <span className="font-mono">{Math.round(amp * 100)}%</span>
              <input type="range" min={0} max={100} value={Math.round(amp * 100)} onChange={(e) => setAmp(Number(e.target.value) / 100)} className="mt-2 w-full accent-[var(--verified)]" />
            </label>
            <div className="mt-5 flex items-center gap-4">
              <button className="btn btn-primary" onClick={() => setRunning(true)} data-testid="flicker-start">Start full-screen</button>
              <motion.span className="h-8 w-8 rounded-full bg-ink" animate={{ opacity: [1 - amp * 0.8, 1, 1 - amp * 0.8] }} transition={{ duration: 60 / perMin, repeat: Infinity, ease: 'easeInOut' }} aria-hidden="true" />
              <span className="text-sm text-muted">preview at {(perMin / 60).toFixed(2)} Hz · tap the screen or press Esc to stop</span>
            </div>
          </div>
        )}
      </div>
      <div ref={stage} onClick={() => setRunning(false)} className={running ? 'fixed inset-0 z-50 cursor-none' : 'hidden'} aria-hidden={!running} data-testid="flicker-stage" />
    </div>
  );
}
