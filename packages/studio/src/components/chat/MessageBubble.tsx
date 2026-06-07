import type { Message } from "../../stores/sessionStore";

interface MessageBubbleProps {
  message: Message;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      data-testid={`message-${message.role}`}
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4 animate-fade-in`}
    >
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-gradient-to-br from-cyan-600/90 to-teal-600/90 text-white shadow-glow-sm"
            : "glass-panel text-gray-100"
        }`}
      >
        {/* Role label */}
        <div className="mb-1.5 flex items-center gap-2">
          <span
            className={`text-[10px] font-semibold uppercase tracking-wider ${
              isUser ? "text-white/60" : "text-cyan-400/60"
            }`}
          >
            {isUser ? "You" : "Assistant"}
          </span>
          <span className="text-[10px] opacity-40 font-mono">
            {formatTime(message.timestamp)}
          </span>
          {message.streaming && (
            <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]" />
          )}
        </div>

        {/* Content */}
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {message.content}
        </p>
      </div>
    </div>
  );
}
