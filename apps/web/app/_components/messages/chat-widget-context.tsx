'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * The floating chat widget's shared state: whether the panel is open and which
 * conversation (if any) it is showing. The top-bar mail icon and the panel both
 * read it, and it persists across client navigation in sessionStorage (guarded, so
 * a blocked store never throws). Desktop only; the panel itself is not rendered on
 * phones.
 */
interface ChatWidget {
  open: boolean;
  /** 'list' when no conversation is selected, else 'thread'. */
  view: 'list' | 'thread';
  activeId: string | null;
  /** The mail icon: open if closed, close if open. */
  toggle: () => void;
  openList: () => void;
  /** Hide the panel but keep the active conversation (reopen restores it). */
  minimize: () => void;
  /** Hide the panel and drop the active conversation (reopen shows the list). */
  close: () => void;
  openThread: (id: string) => void;
  back: () => void;
}

const Ctx = createContext<ChatWidget | null>(null);

/** Null outside the provider (e.g. the platform landing, which has no widget). */
export function useChatWidget(): ChatWidget | null {
  return useContext(Ctx);
}

const KEY = 'campusos_chat';

export function ChatWidgetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as { open?: boolean; activeId?: string | null };
        setOpen(Boolean(s.open));
        setActiveId(s.activeId ?? null);
      }
    } catch {
      // sessionStorage unavailable (private mode, blocked): start closed.
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ open, activeId }));
    } catch {
      // ignore
    }
  }, [open, activeId]);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const openList = useCallback(() => {
    setActiveId(null);
    setOpen(true);
  }, []);
  const minimize = useCallback(() => setOpen(false), []);
  const close = useCallback(() => {
    setActiveId(null);
    setOpen(false);
  }, []);
  const openThread = useCallback((id: string) => {
    setActiveId(id);
    setOpen(true);
  }, []);
  const back = useCallback(() => setActiveId(null), []);

  const value = useMemo<ChatWidget>(
    () => ({
      open,
      view: activeId ? 'thread' : 'list',
      activeId,
      toggle,
      openList,
      minimize,
      close,
      openThread,
      back,
    }),
    [open, activeId, toggle, openList, minimize, close, openThread, back],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
