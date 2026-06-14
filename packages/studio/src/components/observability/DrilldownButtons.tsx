import { ExternalLink, AlertCircle } from "lucide-react";

interface DrilldownLinkProps {
  href: string;
}

export function OpenInTracesButton({ href }: DrilldownLinkProps) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-gray-500 transition-all hover:bg-white/[0.04] hover:text-gray-300"
    >
      <ExternalLink className="h-3 w-3" />
      Open in traces
    </a>
  );
}

export function OpenErrorsInLogsButton({ href }: DrilldownLinkProps) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-red-400/60 transition-all hover:bg-red-500/[0.04] hover:text-red-400"
    >
      <AlertCircle className="h-3 w-3" />
      View errors
    </a>
  );
}
