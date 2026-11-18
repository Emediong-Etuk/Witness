import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { lazy, Suspense, useEffect } from 'react';
import { Layout } from './components/Layout';
import { RouterProvider, useNav, type Route } from './lib/router';
import { Home } from './pages/Home';
import { TourProvider } from './tour/Tour';

const Replay = lazy(() => import('./pages/Replay').then((m) => ({ default: m.Replay })));
const Verify = lazy(() => import('./pages/Verify').then((m) => ({ default: m.Verify })));
const Results = lazy(() => import('./pages/Results').then((m) => ({ default: m.Results })));
const Run = lazy(() => import('./pages/Run').then((m) => ({ default: m.Run })));
const Privacy = lazy(() => import('./pages/Privacy').then((m) => ({ default: m.Privacy })));
const Flicker = lazy(() => import('./pages/Flicker').then((m) => ({ default: m.Flicker })));

const TITLES: Record<Route, string> = {
  '/': 'Witness · camera vitals that show their work',
  '/replay': 'Replay Lab · Witness',
  '/verify': 'Verify · Witness',
  '/results': 'Results · Witness',
  '/run': 'Run it · Witness',
  '/privacy': 'Consent & data · Witness',
  '/tools/flicker': 'Flicker tool · Witness',
};

function Page() {
  const { route, hash } = useNav();
  const reduce = useReducedMotion();
  useEffect(() => {
    document.title = TITLES[route];
  }, [route]);
  useEffect(() => {
    if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }), 60);
  }, [hash, route, reduce]);
  const el = { '/': <Home />, '/replay': <Replay />, '/verify': <Verify />, '/results': <Results />, '/run': <Run />, '/privacy': <Privacy />, '/tools/flicker': <Flicker /> }[route];
  return (
    <AnimatePresence mode="wait">
      <motion.div key={route} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
        <Suspense fallback={<div className="mx-auto max-w-6xl px-5 py-24 text-muted" aria-busy="true">Loading…</div>}>{el}</Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

export function App() {
  return (
    <RouterProvider>
      <TourProvider>
        <Layout>
          <Page />
        </Layout>
      </TourProvider>
    </RouterProvider>
  );
}
