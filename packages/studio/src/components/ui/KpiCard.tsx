import type { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Spinner } from "./Spinner";

/* ------------------------------------------------------------------ */
/*  Root                                                               */
/* ------------------------------------------------------------------ */

function KpiCardRoot({ children }: { children: ReactNode }) {
  return (
    <div className="glass-panel rounded-xl p-4 flex flex-col gap-1">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Label                                                              */
/* ------------------------------------------------------------------ */

function KpiCardLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs uppercase tracking-[0.15em] text-gray-600">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  Value                                                              */
/* ------------------------------------------------------------------ */

function KpiCardValue({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 text-2xl font-bold text-gray-100 text-glow-subtle">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  Change                                                             */
/* ------------------------------------------------------------------ */

interface KpiCardChangeProps {
  value: number;
  lowerIsBetter?: boolean;
}

function KpiCardChange({ value, lowerIsBetter }: KpiCardChangeProps) {
  const positive = value >= 0;
  const effectiveGood = lowerIsBetter ? !positive : positive;
  const colorClass = effectiveGood ? "text-green-400" : "text-red-400";
  const Icon = positive ? TrendingUp : TrendingDown;
  const sign = positive ? "+" : "";

  return (
    <div className="flex items-center gap-1 text-xs">
      <Icon className={`h-3.5 w-3.5 ${colorClass}`} />
      <span className={colorClass}>
        {sign}
        {value.toFixed(1)}%
      </span>
      <span className="text-gray-600 ml-1">vs previous</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  NoChange                                                          */
/* ------------------------------------------------------------------ */

function KpiCardNoChange() {
  return (
    <div className="flex items-center gap-1 text-xs text-gray-500">
      <Minus className="h-3.5 w-3.5" />
      <span>No change</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  NoData                                                            */
/* ------------------------------------------------------------------ */

function KpiCardNoData() {
  return <p className="text-xs text-gray-600">No data available</p>;
}

/* ------------------------------------------------------------------ */
/*  Error                                                             */
/* ------------------------------------------------------------------ */

function KpiCardError({ message }: { message: string }) {
  return <p className="text-xs text-red-400">{message}</p>;
}

/* ------------------------------------------------------------------ */
/*  Loading                                                           */
/* ------------------------------------------------------------------ */

function KpiCardLoading() {
  return (
    <div className="flex items-center justify-center py-4">
      <Spinner size="md" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Compound export                                                    */
/* ------------------------------------------------------------------ */

const KpiCard = Object.assign(KpiCardRoot, {
  Label: KpiCardLabel,
  Value: KpiCardValue,
  Change: KpiCardChange,
  NoChange: KpiCardNoChange,
  NoData: KpiCardNoData,
  Error: KpiCardError,
  Loading: KpiCardLoading,
});

export {
  KpiCard,
  KpiCardLabel,
  KpiCardValue,
  KpiCardChange,
  KpiCardNoChange,
  KpiCardNoData,
  KpiCardError,
  KpiCardLoading,
};
