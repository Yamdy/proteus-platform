const sizes = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

export function Spinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <div
      className={`${sizes[size]} animate-spin rounded-full border-2 border-cyan-500/20 border-t-cyan-400`}
    />
  );
}
