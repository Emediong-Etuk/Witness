import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type MouseEvent } from 'react';

export const ROUTES = ['/', '/replay', '/verify', '/results', '/run', '/privacy', '/tools/flicker'] as const;
export type Route = (typeof ROUTES)[number];

const norm = (p: string): Route => ((ROUTES as readonly string[]).includes(p.replace(/\/+$/, '') || '/') ? ((p.replace(/\/+$/, '') || '/') as Route) : '/');

interface Nav {
  route: Route;
  hash: string;
  go: (to: Route, hash?: string) => void;
}
const Ctx = createContext<Nav>({ route: '/', hash: '', go: () => {} });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => norm(location.pathname));
  const [hash, setHash] = useState(location.hash.slice(1));
  useEffect(() => {
    const on = () => {
      setRoute(norm(location.pathname));
      setHash(location.hash.slice(1));
    };
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  const go = useCallback((to: Route, h = '') => {
    const url = to + (h ? `#${h}` : '');
    if (url !== location.pathname + location.hash) history.pushState(null, '', url);
    setRoute(to);
    setHash(h);
    if (!h) scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, []);
  return <Ctx.Provider value={{ route, hash, go }}>{children}</Ctx.Provider>;
}

export const useNav = () => useContext(Ctx);

export function Link({ to, hash, children, className, ...rest }: { to: Route; hash?: string; children: ReactNode; className?: string } & Record<string, unknown>) {
  const { go, route } = useNav();
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(to, hash);
  };
  return (
    <a href={to + (hash ? `#${hash}` : '')} onClick={onClick} className={className} aria-current={route === to ? 'page' : undefined} {...rest}>
      {children}
    </a>
  );
}
