import { useEffect, useRef, useCallback } from 'react';

export interface SyncRange {
  startDate: Date;
  endDate: Date;
}

interface UseWindowedSyncOptions {
  pastUnits: number;
  futureUnits: number;
  unitDays: number; // e.g., 7 (weeks), 1 (days)
  baseDate: Date;   // The reference point (e.g., current week start)
  
  chunkSizeUnits?: number; // Default: 16
  bufferUnits?: number;    // Default: 4
  throttleMs?: number;     // Default: 2000
  enabled?: boolean;

  /**
   * The actual sync function to call.
   */
  onSync: (range: SyncRange, isManual: boolean) => Promise<void>;
}

export interface UseWindowedSyncResult {
  trigger: () => void;
}

/**
 * useWindowedSync
 * 
 * Manages incremental/windowed data synchronization.
 * It detects scroll changes (pastUnits/futureUnits) and triggers `onSync`
 * with a calculated date range that focuses on the newly exposed area.
 * Uses Throttling to prevent excessive calls during rapid scrolling.
 */
export function useWindowedSync({
  pastUnits,
  futureUnits,
  unitDays,
  baseDate,
  chunkSizeUnits = 16,
  bufferUnits = 4,
  throttleMs = 2000,
  enabled = true,
  onSync
}: UseWindowedSyncOptions): UseWindowedSyncResult {

  // Keep refs for latest values to avoid stale closures
  const stateRef = useRef({ pastUnits, futureUnits, baseDate });
  const onSyncRef = useRef(onSync);

  useEffect(() => {
    stateRef.current = { pastUnits, futureUnits, baseDate };
    onSyncRef.current = onSync;
  }, [pastUnits, futureUnits, baseDate, onSync]);

  const lastSyncedPastUnitsRef = useRef(pastUnits);
  const lastSyncedFutureUnitsRef = useRef(futureUnits);
  
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncTimeRef = useRef<number>(0);

  // Helper: Calculate Date by offsetting baseDate by N units
  const getDateByOffset = useCallback((offsetUnits: number): Date => {
    const d = new Date(stateRef.current.baseDate);
    d.setDate(d.getDate() + (offsetUnits * unitDays));
    return d;
  }, [unitDays]);

  const triggerSync = useCallback((isManual: boolean) => {
    const { pastUnits: currentPast, futureUnits: currentFuture } = stateRef.current;

    // 1. Calculate Range
    let startDate: Date;
    let endDate: Date;

    const hasScrolledPast = currentPast > lastSyncedPastUnitsRef.current + bufferUnits;
    const hasScrolledFuture = currentFuture > lastSyncedFutureUnitsRef.current + bufferUnits;

    if (isManual && hasScrolledPast) {
      // Windowed Fetch: Past
      startDate = getDateByOffset(-(currentPast + chunkSizeUnits));
      endDate = getDateByOffset(-(currentPast - bufferUnits));
      console.log(`[useWindowedSync] Windowed(Past): ${startDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}`);

    } else if (isManual && hasScrolledFuture) {
      // Windowed Fetch: Future
      startDate = getDateByOffset(currentFuture - bufferUnits);
      endDate = getDateByOffset(currentFuture + chunkSizeUnits);
      console.log(`[useWindowedSync] Windowed(Future): ${startDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}`);

    } else {
      // Standard Range (Periodic or Small Scroll)
      // Fetch: [-PastBuffer ... +FutureBuffer]
      startDate = getDateByOffset(-(currentPast + bufferUnits));
      endDate = getDateByOffset(currentFuture + bufferUnits);
    }

    const range = { startDate, endDate };

    // 2. Execute Sync
    if (onSyncRef.current) {
        onSyncRef.current(range, isManual).then(() => {
          // Update Refs on success
          if (isManual) {
            lastSyncedPastUnitsRef.current = Math.max(lastSyncedPastUnitsRef.current, currentPast);
            lastSyncedFutureUnitsRef.current = Math.max(lastSyncedFutureUnitsRef.current, currentFuture);
          }
        });
    }
  }, [chunkSizeUnits, bufferUnits, getDateByOffset]);

  const trigger = useCallback(() => triggerSync(true), [triggerSync]);

  // Effect: Watch for changes and trigger sync (Throttled)
  useEffect(() => {
    if (!enabled) return;

    const now = Date.now();
    const timeSinceLast = now - lastSyncTimeRef.current;
    
    const runSync = () => {
      triggerSync(true); // Treat as manual/active sync
      lastSyncTimeRef.current = Date.now();
    };

    // Prop changes imply manual scroll -> trigger Sync
    if (timeSinceLast >= throttleMs) {
      // Throttle: Run immediately
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      runSync();
    } else {
      // Debounce: Schedule trailing
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => {
        runSync();
      }, throttleMs - timeSinceLast);
    }
    
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [pastUnits, futureUnits, enabled, throttleMs, triggerSync]); 

  // Separate Effect for Periodic Sync (Background)
  useEffect(() => {
    if (!enabled) return;
    
    const interval = setInterval(() => {
      triggerSync(false); // Periodic
    }, 60 * 1000);

    return () => clearInterval(interval);
  }, [enabled, triggerSync]);

  return { trigger };
}
