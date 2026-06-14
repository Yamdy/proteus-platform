import { useMetricsFilters } from "../../hooks/useMetricsFilters";
import type { MetricsPreset } from "../../lib/metrics-filters";

const PRESET_OPTIONS: Array<{ value: MetricsPreset; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "3d", label: "3d" },
  { value: "7d", label: "7d" },
  { value: "14d", label: "14d" },
  { value: "30d", label: "30d" },
  { value: "custom", label: "Custom" },
];

export default function DatePresetSelector() {
  const { preset, setPreset, setCustomRange } = useMetricsFilters();

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as MetricsPreset;
    if (value === "custom") {
      // Set default custom range to last 7 days
      const now = Date.now();
      setCustomRange(now - 604_800_000, now);
    } else {
      setPreset(value);
    }
  };

  const handleFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const from = new Date(e.target.value).getTime();
    const to = preset === "custom" ? Date.now() : from + 604_800_000;
    if (!isNaN(from)) {
      setCustomRange(from, to);
    }
  };

  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const to = new Date(e.target.value).getTime();
    const from = preset === "custom" ? to - 604_800_000 : to;
    if (!isNaN(to)) {
      setCustomRange(from, to);
    }
  };

  return (
    <div data-testid="date-preset-selector" className="flex items-center gap-2">
      <select
        data-testid="preset-select"
        value={preset}
        onChange={handlePresetChange}
        className="rounded-md border border-white/[0.08] bg-surface-50/60 px-2.5 py-1.5 text-xs text-gray-300 transition-colors hover:border-white/[0.12] focus:border-cyan-500/30 focus:outline-none"
      >
        {PRESET_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            data-testid="custom-range-from"
            type="date"
            onChange={handleFromChange}
            className="rounded-md border border-white/[0.08] bg-surface-50/60 px-2 py-1.5 text-xs text-gray-300 transition-colors hover:border-white/[0.12] focus:border-cyan-500/30 focus:outline-none"
          />
          <span className="text-xs text-gray-600">to</span>
          <input
            data-testid="custom-range-to"
            type="date"
            onChange={handleToChange}
            className="rounded-md border border-white/[0.08] bg-surface-50/60 px-2 py-1.5 text-xs text-gray-300 transition-colors hover:border-white/[0.12] focus:border-cyan-500/30 focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}
