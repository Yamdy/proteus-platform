import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

interface TimelineSearchProps {
  value: string;
  onChange: (value: string) => void;
}

const DEBOUNCE_MS = 300;

export default function TimelineSearch({ value, onChange }: TimelineSearchProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external value changes into local state
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setLocalValue(next);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onChange(next);
      }, DEBOUNCE_MS);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLocalValue("");
    onChange("");
  }, [onChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="relative flex items-center">
      <Search className="absolute left-3 h-3.5 w-3.5 text-gray-600" />
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        placeholder="Search spans..."
        className="w-full rounded-lg border border-white/[0.06] bg-surface-50/40 py-2 pl-9 pr-9 text-xs text-gray-300 placeholder-gray-700 transition-all focus:border-cyan-500/30 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
      />
      {localValue.length > 0 && (
        <button
          onClick={handleClear}
          aria-label="Clear"
          className="absolute right-2.5 rounded p-0.5 text-gray-600 transition-colors hover:text-gray-400"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
