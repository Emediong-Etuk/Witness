import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useNav } from '../lib/router';
import { STEPS } from './steps';

interface TourApi {
  active: boolean;
  index: number;
  start: (i?: number) => void;
  end: (reason?: 'done' | 'dismissed') => void;
}
const Ctx = createContext<TourApi>({ active: false, index: 0, start: () => {}, end: () => {} });
export const useTour = () => useContext(Ctx);

const KEY = 'witness-tour-v1';
const seen = () => {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return true;
  }
};
const remember = (v: string) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* private mode */
  }
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const PAD = 10;

function findTarget(id: string): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)];
  return all.find((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed') ?? null;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [prompt, setPrompt] = useState(false);
  const start = useCallback((i = 0) => {
    setPrompt(false);
    setIndex(i);
    setActive(true);
  }, []);
  const end = useCallback((reason: 'done' | 'dismissed' = 'dismissed') => {
    setActive(false);
    remember(reason);
  }, []);
  useEffect(() => {
    if (seen() || navigator.webdriver) return;
    const t = setTimeout(() => setPrompt(true), 1400);
    return () => clearTimeout(t);
  }, []);
  return (
    <Ctx.Provider value={{ active, index, start, end }}>
      {children}
      <AnimatePresence>{active ? <Overlay key="tour" index={index} setIndex={setIndex} end={end} /> : null}</AnimatePresence>
      <AnimatePresence>
        {prompt && !active ? (
          <motion.div
            role="dialog"
            aria-label="Guided tour"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }}
            className="glass fixed bottom-5 right-5 z-50 w-[320px] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-hairline p-5 shadow-2xl"
            data-testid="tour-prompt"
          >
            <p className="font-display text-2xl">New here?</p>
            <p className="mt-1 text-sm text-muted">Take the 90-second tour of the evidence, the replay and the verifier.</p>
            <div className="mt-4 flex gap-2">
              <button className="btn btn-primary py-2 text-sm" onClick={() => start(0)}>Take the tour</button>
              <button className="btn py-2 text-sm" onClick={() => { setPrompt(false); remember('dismissed'); }}>No thanks</button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

function Overlay({ index, setIndex, end }: { index: number; setIndex: (i: number) => void; end: (r?: 'done' | 'dismissed') => void }) {
  const step = STEPS[index]!;
  const { route, go } = useNav();
  const reduce = useReducedMotion();
  const [box, setBox] = useState<Box | null>(null);
  const [vw, setVw] = useState({ w: innerWidth, h: innerHeight });
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);
  const last = index === STEPS.length - 1;

  const next = useCallback(() => (last ? end('done') : setIndex(index + 1)), [index, last, end, setIndex]);
  const prev = useCallback(() => index > 0 && setIndex(index - 1), [index, setIndex]);

  // Route first, then find the target, scroll it into view, and track its box.
  useEffect(() => {
    if (route !== step.route) go(step.route);
  }, [step.route, route, go]);
  useEffect(() => {
    if (route !== step.route) return;
    let el: HTMLElement | null = null;
    let raf = 0;
    let tries = 0;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({ x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 });
      setVw({ w: innerWidth, h: innerHeight });
    };
    const find = () => {
      if (!step.target) {
        setBox(null);
        return;
      }
      el = findTarget(step.target);
      if (!el && tries++ < 120) {
        raf = requestAnimationFrame(find);
        return;
      }
      if (!el) {
        setBox(null);
        return;
      }
      el.scrollIntoView({ block: el.offsetHeight > innerHeight * 0.6 ? 'start' : 'center', behavior: reduce ? 'auto' : 'smooth' });
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(el);
    };
    find();
    const on = () => measure();
    addEventListener('scroll', on, { passive: true });
    addEventListener('resize', on);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      removeEventListener('scroll', on);
      removeEventListener('resize', on);
    };
  }, [index, route, step.route, step.target, reduce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.getAttribute('role') === 'slider')) {
        if (e.key === 'Escape') end('dismissed');
        return;
      }
      if (e.key === 'Escape') end('dismissed');
      else if (e.key === 'ArrowRight' || (e.key === 'Enter' && t?.tagName !== 'BUTTON')) next();
      else if (e.key === 'ArrowLeft') prev();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [next, prev, end]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
    cardRef.current?.focus({ preventScroll: true });
  }, [index]);

  // Card placement: below the target if it fits, else above, else centred (and a bottom sheet on small screens).
  const mobile = vw.w < 640;
  const CW = Math.min(380, vw.w - 32);
  let card: { left: number; top: number };
  if (mobile || !box) card = mobile ? { left: 16, top: vw.h - cardH - 16 } : { left: (vw.w - CW) / 2, top: (vw.h - cardH) / 2 };
  else {
    // Prefer below, then above, then beside the target; if it fills the screen, dock at the bottom edge.
    const below = box.y + box.h + 14;
    const above = box.y - cardH - 14;
    const clampTop = (y: number) => Math.max(80, Math.min(vw.h - cardH - 16, y));
    const centredLeft = Math.min(vw.w - CW - 16, Math.max(16, box.x + box.w / 2 - CW / 2));
    if (below + cardH < vw.h - 8) card = { left: centredLeft, top: below };
    else if (above > 72) card = { left: centredLeft, top: above };
    else if (vw.w - (box.x + box.w) > CW + 28) card = { left: box.x + box.w + 14, top: clampTop(box.y) };
    else if (box.x > CW + 28) card = { left: box.x - CW - 14, top: clampTop(box.y) };
    else card = { left: vw.w - CW - 20, top: vw.h - cardH - 20 };
  }
  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 220, damping: 28 };
  const hole = box ?? { x: vw.w / 2, y: vw.h / 2, w: 0, h: 0 };
  const blockers = box
    ? [
        { left: 0, top: 0, width: vw.w, height: Math.max(0, box.y) },
        { left: 0, top: box.y + box.h, width: vw.w, height: Math.max(0, vw.h - box.y - box.h) },
        { left: 0, top: box.y, width: Math.max(0, box.x), height: box.h },
        { left: box.x + box.w, top: box.y, width: Math.max(0, vw.w - box.x - box.w), height: box.h },
      ]
    : [{ left: 0, top: 0, width: vw.w, height: vw.h }];

  return (
    <motion.div className="pointer-events-none fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} data-testid="tour">
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <mask id="tour-hole">
            <rect width="100%" height="100%" fill="white" />
            <motion.rect rx="16" fill="black" initial={false} animate={{ x: hole.x, y: hole.y, width: hole.w, height: hole.h }} transition={spring} />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="var(--bg)" opacity="0.74" mask="url(#tour-hole)" />
      </svg>
      {/* click-blockers around the hole, so the highlighted control stays usable */}
      {blockers.map((b, i) => (
        <div key={i} className="pointer-events-auto absolute" style={b} />
      ))}
      {box ? (
        <motion.div
          className="pointer-events-none absolute rounded-2xl border-2 border-verified"
          initial={false}
          animate={{ left: box.x, top: box.y, width: box.w, height: box.h, boxShadow: reduce ? undefined : ['0 0 0 0 rgba(124,242,176,0.45)', '0 0 0 10px rgba(124,242,176,0)'] }}
          transition={{ ...spring, boxShadow: { duration: 1.6, repeat: Infinity } }}
          aria-hidden="true"
        />
      ) : null}
      <motion.div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="glass pointer-events-auto absolute rounded-2xl border border-hairline p-5 shadow-2xl outline-none"
        style={{ width: CW }}
        initial={false}
        animate={{ left: card.left, top: card.top }}
        transition={spring}
        data-testid="tour-card"
      >
        <div className="mb-3 h-1 overflow-hidden rounded-full bg-hairline">
          <motion.div className="h-full bg-verified" initial={false} animate={{ width: `${((index + 1) / STEPS.length) * 100}%` }} transition={{ duration: 0.3 }} />
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={index} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: reduce ? 0 : 0.18 }}>
            <p className="font-mono text-[11px] text-muted" aria-live="polite">Step {index + 1} of {STEPS.length}</p>
            <h2 id="tour-title" className="mt-1 font-display text-2xl leading-tight">{step.title}</h2>
            <p id="tour-body" className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
            {step.tryIt ? <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-verified/40 px-2.5 py-1 text-xs text-verified"><span aria-hidden="true">☞</span> {step.tryIt}</p> : null}
          </motion.div>
        </AnimatePresence>
        <div className="mt-5 flex items-center gap-2">
          <button className="text-xs text-muted hover:text-ink" onClick={() => end('dismissed')} data-testid="tour-skip">Skip tour</button>
          <span className="ml-auto" />
          <button className="btn py-1.5 text-sm" onClick={prev} disabled={index === 0} aria-keyshortcuts="ArrowLeft">Back</button>
          <button className="btn btn-primary py-1.5 text-sm" onClick={next} aria-keyshortcuts="ArrowRight" data-testid="tour-next">
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
