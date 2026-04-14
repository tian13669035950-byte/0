import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from "react";

// ─── Types (shared between context and parallel.tsx) ──────────────────────────
export interface TrackState {
  activeStep: number | null;
  doneSteps: Record<number, boolean>;
  capturedVars: Record<string, string>;
  done: boolean;
  error?: string;
  duration?: number;
  screenshot?: string;
  liveUrl?: string;
}

// ─── Context value ────────────────────────────────────────────────────────────
interface ParallelContextValue {
  // Reactive UI state (survives navigation — lives in context, not component)
  running: boolean;
  loopRunning: boolean;
  loopProgress: { cur: number; tot: number; ok: number; fail: number } | null;
  trackStates: TrackState[];

  setRunning: React.Dispatch<React.SetStateAction<boolean>>;
  setLoopRunning: React.Dispatch<React.SetStateAction<boolean>>;
  setLoopProgress: React.Dispatch<React.SetStateAction<{ cur: number; tot: number; ok: number; fail: number } | null>>;
  setTrackStates: React.Dispatch<React.SetStateAction<TrackState[]>>;

  // Stable refs (survive navigation, safe to capture in async closures)
  abortRef: React.MutableRefObject<AbortController | null>;
  parallelSessionIdRef: React.MutableRefObject<string | null>;
  watchEsRefs: React.MutableRefObject<Map<number, EventSource>>;
  closeWatchTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  stopLoopRef: React.MutableRefObject<boolean>;

  closeAllWatch: () => void;
}

const ParallelContext = createContext<ParallelContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ParallelProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false);
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopProgress, setLoopProgress] = useState<{ cur: number; tot: number; ok: number; fail: number } | null>(null);
  const [trackStates, setTrackStates] = useState<TrackState[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const parallelSessionIdRef = useRef<string | null>(null);
  const watchEsRefs = useRef<Map<number, EventSource>>(new Map());
  const closeWatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopLoopRef = useRef(false);

  const closeAllWatch = useCallback(() => {
    watchEsRefs.current.forEach(es => es.close());
    watchEsRefs.current.clear();
  }, []);

  return (
    <ParallelContext.Provider value={{
      running, loopRunning, loopProgress, trackStates,
      setRunning, setLoopRunning, setLoopProgress, setTrackStates,
      abortRef, parallelSessionIdRef, watchEsRefs, closeWatchTimerRef, stopLoopRef,
      closeAllWatch,
    }}>
      {children}
    </ParallelContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useParallel(): ParallelContextValue {
  const ctx = useContext(ParallelContext);
  if (!ctx) throw new Error("useParallel must be used within <ParallelProvider>");
  return ctx;
}
