interface TimelineTypeLegendProps {
  spanTypes: string[];
  fadedTypes: Set<string>;
  onToggleType: (type: string) => void;
  onShowAll: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  llm: "bg-purple-400",
  tool: "bg-cyan-400",
  retrieval: "bg-amber-400",
  http: "bg-teal-400",
  agent: "bg-emerald-400",
  chain: "bg-indigo-400",
  default: "bg-gray-500",
};

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] ?? TYPE_COLORS.default;
}

export default function TimelineTypeLegend({
  spanTypes,
  fadedTypes,
  onToggleType,
  onShowAll,
}: TimelineTypeLegendProps) {
  const hasFaded = fadedTypes.size > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px]">
      <span className="text-gray-600">Types:</span>
      {spanTypes.map((type) => {
        const isFaded = fadedTypes.has(type);
        return (
          <button
            key={type}
            data-type-entry
            onClick={() => onToggleType(type)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 transition-all duration-200 ${
              isFaded
                ? "opacity-30 hover:opacity-60"
                : "bg-white/[0.04]"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${getTypeColor(type)}`}
            />
            <span className={isFaded ? "text-gray-600" : "text-gray-400"}>
              {type}
            </span>
          </button>
        );
      })}
      {hasFaded && (
        <button
          onClick={onShowAll}
          className="ml-1 rounded-md px-2 py-1 text-gray-500 transition-colors hover:bg-white/[0.04] hover:text-gray-300"
        >
          Show all
        </button>
      )}
    </div>
  );
}
