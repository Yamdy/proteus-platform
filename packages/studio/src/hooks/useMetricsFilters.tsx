import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import { useSearchParams } from "react-router-dom";
import type { ReactNode } from "react";
import type {
  MetricsDimensionalFilter,
  MetricsPreset,
  TimeWindow,
} from "../lib/metrics-filters";
import {
  buildMetricsDimensionalFilter,
  computeAnchoredWindow,
  computeFilterKey,
} from "../lib/metrics-filters";

// --- Context value shape ---

export interface MetricsFiltersContextValue {
  preset: MetricsPreset;
  filterTokens: Record<string, string | string[]>;
  dimensionalFilter: MetricsDimensionalFilter;
  dimensionalFilterKey: string;
  customRange: { from: number; to: number } | null;
  setPreset: (preset: MetricsPreset) => void;
  setFilterTokens: (tokens: Record<string, string | string[]>) => void;
  setCustomRange: (from: number, to: number) => void;
}

const MetricsContext = createContext<MetricsFiltersContextValue | null>(null);

const STORAGE_KEY = "proteus:metrics:saved-filters";

// --- Helpers ---

const KNOWN_PARAM_KEYS = new Set([
  "preset",
  "entityType",
  "entityName",
  "sessionId",
  "tags",
  "from",
  "to",
]);

function readFilterTokensFromParams(
  params: URLSearchParams,
): Record<string, string | string[]> {
  const tokens: Record<string, string | string[]> = {};
  for (const key of KNOWN_PARAM_KEYS) {
    if (key === "preset" || key === "from" || key === "to") continue;
    const value = params.get(key);
    if (value !== null) {
      tokens[key] = value;
    }
  }
  return tokens;
}


function loadSavedFilters(): Record<string, string | string[]> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveFilters(tokens: Record<string, string | string[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // localStorage may be unavailable
  }
}

// --- Provider ---

interface MetricsProviderProps {
  children: ReactNode;
}

export function MetricsProvider({ children }: MetricsProviderProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read preset from URL, default to "7d"
  const rawPreset = searchParams.get("preset");
  const preset: MetricsPreset =
    rawPreset === "24h" ||
    rawPreset === "3d" ||
    rawPreset === "7d" ||
    rawPreset === "14d" ||
    rawPreset === "30d" ||
    rawPreset === "custom"
      ? rawPreset
      : "7d";

  // Read filter tokens from URL, hydrate from localStorage if URL is clean
  const filterTokens = useMemo(() => {
    const fromUrl = readFilterTokensFromParams(searchParams);
    if (Object.keys(fromUrl).length > 0) return fromUrl;

    // URL is filter-clean: try hydrating from localStorage
    const saved = loadSavedFilters();
    return saved ?? {};
  }, [searchParams]);

  // Derive dimensional filter
  const dimensionalFilter = useMemo(
    () => buildMetricsDimensionalFilter(filterTokens),
    [filterTokens],
  );

  const dimensionalFilterKey = useMemo(
    () => JSON.stringify(dimensionalFilter),
    [dimensionalFilter],
  );

  // Read custom range from URL
  const customRange = useMemo(() => {
    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    if (fromStr && toStr) {
      const from = Number(fromStr);
      const to = Number(toStr);
      if (!isNaN(from) && !isNaN(to)) {
        return { from, to };
      }
    }
    return null;
  }, [searchParams]);

  // Actions
  const setPreset = useCallback(
    (newPreset: MetricsPreset) => {
      setSearchParams((prev: URLSearchParams) => {
        const next = new URLSearchParams(prev);
        next.set("preset", newPreset);
        // Clear custom range params if switching away from custom
        if (newPreset !== "custom") {
          next.delete("from");
          next.delete("to");
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const setFilterTokens = useCallback(
    (tokens: Record<string, string | string[]>) => {
      setSearchParams((prev: URLSearchParams) => {
        const next = new URLSearchParams(prev);
        // Clear old filter keys
        for (const key of KNOWN_PARAM_KEYS) {
          if (key === "preset" || key === "from" || key === "to") continue;
          next.delete(key);
        }
        // Set new filter keys
        for (const [key, value] of Object.entries(tokens)) {
          if (Array.isArray(value)) {
            for (const v of value) {
              next.append(key, v);
            }
          } else {
            next.set(key, value);
          }
        }
        return next;
      });
      // Persist to localStorage
      saveFilters(tokens);
    },
    [setSearchParams],
  );

  const setCustomRange = useCallback(
    (from: number, to: number) => {
      setSearchParams((prev: URLSearchParams) => {
        const next = new URLSearchParams(prev);
        next.set("preset", "custom");
        next.set("from", String(from));
        next.set("to", String(to));
        return next;
      });
    },
    [setSearchParams],
  );

  const value: MetricsFiltersContextValue = useMemo(
    () => ({
      preset,
      filterTokens,
      dimensionalFilter,
      dimensionalFilterKey,
      customRange,
      setPreset,
      setFilterTokens,
      setCustomRange,
    }),
    [
      preset,
      filterTokens,
      dimensionalFilter,
      dimensionalFilterKey,
      customRange,
      setPreset,
      setFilterTokens,
      setCustomRange,
    ],
  );

  return (
    <MetricsContext.Provider value={value}>{children}</MetricsContext.Provider>
  );
}

// --- Hook ---

export interface UseMetricsFiltersReturn {
  filters: {
    timestamp: TimeWindow;
    dimensionalFilter: MetricsDimensionalFilter;
  };
  filterKey: string;
  preset: MetricsPreset;
  setPreset: (preset: MetricsPreset) => void;
  setFilterTokens: (tokens: Record<string, string | string[]>) => void;
  setCustomRange: (from: number, to: number) => void;
}

export function useMetricsFilters(): UseMetricsFiltersReturn {
  const ctx = useContext(MetricsContext);
  if (!ctx) {
    throw new Error(
      "useMetricsFilters must be used within a <MetricsProvider>",
    );
  }

  const {
    preset,
    dimensionalFilter,
    customRange,
    setPreset: ctxSetPreset,
    setFilterTokens,
    setCustomRange: ctxSetCustomRange,
  } = ctx;

  // Freeze "now" at window-change time using a ref
  const anchorRef = useRef<number>(Date.now());
  const lastPresetRef = useRef<MetricsPreset>(preset);

  // Reset anchor when preset changes
  if (lastPresetRef.current !== preset) {
    anchorRef.current = Date.now();
    lastPresetRef.current = preset;
  }

  const timestamp = useMemo(() => {
    if (preset === "custom" && customRange) {
      return computeAnchoredWindow("custom", undefined, customRange);
    }
    return computeAnchoredWindow(preset, anchorRef.current);
  }, [preset, customRange]);

  const filterKey = useMemo(() => {
    return computeFilterKey(timestamp, dimensionalFilter);
  }, [timestamp, dimensionalFilter]);

  // Wrapped setters that also update anchor
  const setPreset = useCallback(
    (newPreset: MetricsPreset) => {
      anchorRef.current = Date.now();
      ctxSetPreset(newPreset);
    },
    [ctxSetPreset],
  );

  const setCustomRange = useCallback(
    (from: number, to: number) => {
      ctxSetCustomRange(from, to);
    },
    [ctxSetCustomRange],
  );

  return {
    filters: {
      timestamp,
      dimensionalFilter,
    },
    filterKey,
    preset,
    setPreset,
    setFilterTokens,
    setCustomRange,
  };
}
