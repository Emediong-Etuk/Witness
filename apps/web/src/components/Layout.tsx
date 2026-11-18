import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNav, type Route } from '../lib/router';
import { useTour } from '../tour/Tour';
import { SITE } from '../site.config';

export const NAV: { to: Route; label: string; tour: string }[] = [
  { to: '/', label: 'Overview', tour: 'nav-home' },
  { to: '/replay', label: 'Replay Lab', tour: 'nav-replay' },
  { to: '/verify', label: 'Verify', tour: 'nav-verify' },
  { to: '/results', label: 'Results', tour: 'nav-results' },
  { to: '/run', label: 'Run it', tour: 'nav-run' },
  { to: '/privacy', label: 'Consent & data', tour: 'nav-privacy' },
  { to: '/tools/flicker', label: 'Flicker tool', tour: 'nav-flicker' },
];

type Theme = 'system' | 'dark' | 'light';
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('witness-theme') as Theme) ?? 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('witness-theme', theme);
    } catch {
      /* private mode */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'system' ? 'dark' : t === 'dark' ? 'light' : 'system'))];
}

function ThemeIcon({ theme }: { theme: Theme }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (theme === 'dark') return <svg {...common}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;
  if (theme === 'light') return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  return <svg {...common}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
}

export function Layout({ children }: { children: ReactNode }) {
  const { route } = useNav();
  const tour = useTour();
  const [theme, cycle] = useTheme();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 8);
    on();
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  useEffect(() => setMenu(false), [route]);
  return (
    <>
      <div className="backdrop" aria-hidden="true" />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-bg">Skip to content</a>
      <header className={`glass sticky top-0 z-30 border-b transition-[border-color] duration-300 ${scrolled ? 'border-hairline' : 'border-transparent'}`}>
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
          <Link to="/" className="flex items-center gap-2" aria-label="Witness home">
            <img src="/favicon.svg" alt="" width="26" height="26" />
            <span className="font-display text-2xl tracking-tight">Witness</span>
          </Link>
          <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label="Main" data-tour="nav">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} data-tour={n.tour} className="relative rounded-full px-3 py-1.5 text-sm text-muted transition hover:text-ink aria-[current=page]:text-ink">
                {route === n.to ? <motion.span layoutId="nav-pill" className="absolute inset-0 -z-10 rounded-full bg-raised-2" transition={{ type: 'spring', stiffness: 400, damping: 34 }} /> : null}
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => tour.start()} className="btn py-1.5 text-sm" data-tour="tour-button" data-testid="tour-start">
              <span aria-hidden="true">✦</span> <span className="hidden sm:inline">Take the tour</span><span className="sm:hidden">Tour</span>
            </button>
            <button onClick={cycle} className="grid h-9 w-9 place-items-center rounded-full border border-hairline text-muted transition hover:text-ink" aria-label={`Theme: ${theme}. Click to change.`} title={`Theme: ${theme}`}>
              <ThemeIcon theme={theme} />
            </button>
            <button className="grid h-9 w-9 place-items-center rounded-full border border-hairline lg:hidden" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Menu">
              ≡
            </button>
          </div>
        </div>
        <AnimatePresence>
          {menu ? (
            <motion.nav initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-hairline lg:hidden" aria-label="Main (mobile)">
              <div className="grid gap-1 px-5 py-3">
                {NAV.map((n) => (
                  <Link key={n.to} to={n.to} className="rounded-lg px-3 py-2 text-muted aria-[current=page]:bg-raised-2 aria-[current=page]:text-ink">{n.label}</Link>
                ))}
              </div>
            </motion.nav>
          ) : null}
        </AnimatePresence>
      </header>
      <main id="main">{children}</main>
      <footer className="mt-24 border-t border-hairline">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-10 text-sm text-muted md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <p className="font-display text-xl text-ink">No reading without a clean window.</p>
            <p className="mt-2 max-w-md">General wellness information, not medical advice. Camera readings can be wrong. If you feel unwell, contact a health professional.</p>
          </div>
          <div className="grid content-start gap-1">
            {NAV.slice(1).map((n) => <Link key={n.to} to={n.to} className="hover:text-ink">{n.label}</Link>)}
          </div>
          <div className="grid content-start gap-1">
            <a href={SITE.repoUrl} className="hover:text-ink">Source code (MIT)</a>
            <span>Built on the Presage SmartSpectra SDK</span>
            <span>This site loads nothing from third parties until you press play on a video.</span>
          </div>
        </div>
      </footer>
    </>
  );
}
