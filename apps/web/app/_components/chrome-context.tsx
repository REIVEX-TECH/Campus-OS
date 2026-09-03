'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

/**
 * The state the top bar and the sidebar share: whether the mobile drawer is open.
 *
 * The hamburger lives in the top bar and the drawer is the sidebar, and the page
 * content sits between them in the DOM, so neither can own the state for the
 * other. A context is the small piece that joins them without either importing
 * the other.
 *
 * The drawer is a real modal while it is open: the rest of the chrome goes
 * `inert`, so Tab and the screen reader cursor cannot leave it, Escape closes it,
 * and focus returns to the hamburger that opened it.
 */

interface Chrome {
  open: boolean;
  openDrawer: () => void;
  /** Close and return focus to the hamburger. For Escape, the backdrop, the X. */
  closeAndReturnFocus: () => void;
  /** Close without moving focus. For nav links, which navigate the page. */
  closeForNav: () => void;
  drawerRef: RefObject<HTMLDivElement | null>;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}

const ChromeContext = createContext<Chrome | null>(null);

export function useChrome(): Chrome {
  const chrome = useContext(ChromeContext);
  if (!chrome) throw new Error('useChrome used outside ChromeProvider');
  return chrome;
}

/** Everything the drawer makes inert while it is open. */
function chromeOutsideDrawer(): (HTMLElement | null)[] {
  return [document.getElementById('main'), document.getElementById('app-topbar')];
}

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const dropInert = useCallback((): void => {
    for (const el of chromeOutsideDrawer()) el?.removeAttribute('inert');
  }, []);

  const openDrawer = useCallback((): void => setOpen(true), []);

  const closeAndReturnFocus = useCallback((): void => {
    dropInert();
    setOpen(false);
    menuButtonRef.current?.focus();
  }, [dropInert]);

  const closeForNav = useCallback((): void => {
    dropInert();
    setOpen(false);
  }, [dropInert]);

  useEffect(() => {
    if (!open) return;
    const outside = chromeOutsideDrawer();
    for (const el of outside) el?.setAttribute('inert', '');
    // Move focus in on the next frame, after inert has blurred the hamburger, so
    // it lands on the dialog rather than on <body>.
    const raf = requestAnimationFrame(() => drawerRef.current?.focus());
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeAndReturnFocus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      for (const el of outside) el?.removeAttribute('inert');
    };
  }, [open, closeAndReturnFocus]);

  const value = useMemo(
    () => ({ open, openDrawer, closeAndReturnFocus, closeForNav, drawerRef, menuButtonRef }),
    [open, openDrawer, closeAndReturnFocus, closeForNav],
  );

  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}
