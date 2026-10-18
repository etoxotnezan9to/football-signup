import { createContext, useContext, type ReactNode } from 'react';
import type { Realtime } from './realtime.ts';
import type { Session } from './session.ts';

export interface AppContextValue {
  session: Session;
  realtime: Realtime;
  navigate: (hash: string) => void;
  showToast: (text: string) => void;
  setPopout: (node: ReactNode | null) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext не найден');
  return ctx;
}
