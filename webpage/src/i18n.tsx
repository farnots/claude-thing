import { createContext, useContext, useMemo } from 'react';
import { en, type Key } from './locales/en';
import { fr } from './locales/fr';
import { useStatus } from './hooks';

// Which language this page draws in.
//
// It is not this page's decision: the daemon resolves the user's Auto/English/
// Français setting against System Settings and reports the answer on /status, and
// the device reads the very same field out of its snapshot. One source of truth,
// so the two surfaces cannot end up in different languages.
//
// navigator.language is deliberately not consulted. It would be a second opinion
// with nothing to reconcile it against, and it says nothing about the setting the
// user actually picked.

const CATALOGS: Record<string, Record<string, string>> = { en, fr };

export type Translate = (key: Key, params?: Record<string, string | number>) => string;

function translator(lang: string): Translate {
  const table = CATALOGS[lang] || en;
  return (key, params) => {
    const s = table[key] ?? en[key];
    if (s === undefined) return key;
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k])));
  };
}

const LocaleContext = createContext<{ lang: string; t: Translate }>({ lang: 'en', t: translator('en') });

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Polls /status like every other consumer, and refreshes on any daemon event,
  // so switching the language on the Settings page repaints the page it is on.
  const { status } = useStatus([]);
  const lang = status?.settings?.lang ?? 'en';
  const value = useMemo(() => ({ lang, t: translator(lang) }), [lang]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT() {
  return useContext(LocaleContext).t;
}

export function useLang() {
  return useContext(LocaleContext).lang;
}
