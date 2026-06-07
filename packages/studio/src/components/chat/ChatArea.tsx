import { useEffect, useRef, useState } from "react";
import { useChat } from "../../hooks/useChat";
import { useSessionStore } from "../../stores/sessionStore";
import MessageBubble from "./MessageBubble";

export default function ChatArea() {
  const { currentSession, messages, streamingSessions } = useSessionStore();
  const { sendMessage, streamResponse, cancelStream } = useChat();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sessionId = currentSession?.id;
  const isStreaming = sessionId ? streamingSessions.has(sessionId) : false;

  const currentMessages = sessionId
    ? messages[sessionId] ?? []
    : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || !sessionId || isStreaming) return;

    setInput("");
    setError(null);

    try {
      await sendMessage(sessionId, trimmed);
      await streamResponse(sessionId, trimmed, {
        onError: (err) => setError(err.message),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCancel = () => {
    if (sessionId) {
      cancelStream(sessionId);
    }
  };

  if (!currentSession) {
    return (
      <div
        data-testid="chat-empty"
        className="flex h-full flex-col items-center justify-center gap-4"
      >
        <div className="relative">
          <svg
            className="h-16 w-16 text-cyan-500/20"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={0.75}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <div className="absolute inset-0 animate-glow-pulse rounded-full bg-cyan-500/5 blur-xl" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-gray-400">
            Select or create a session
          </p>
          <p className="mt-1 text-xs text-gray-600">
            Start a conversation to see the magic
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="chat-area" className="flex h-full flex-col">
      {/* Header */}
      <div className="glass-panel-strong flex items-center justify-between px-6 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">
            {currentSession.name}
          </h2>
          <p className="text-[10px] text-gray-600 font-mono">
            {currentMessages.length} message
            {currentMessages.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
        {isStreaming && (
          <button
            onClick={handleCancel}
            data-testid="stop-stream-btn"
            className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs text-red-400 transition-all hover:border-red-500/40 hover:bg-red-500/10"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            Stop
          </button>
        )}
        </div>
      </div>

      {/* Messages */}
      <div
        data-testid="chat-messages"
        className="flex-1 overflow-y-auto px-6 py-4"
      >
        {currentMessages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="flex gap-1.5">
              <span className="h-2 w-2 rounded-full bg-cyan-500/20 animate-float" />
              <span className="h-2 w-2 rounded-full bg-teal-400/20 animate-float [animation-delay:0.5s]" />
              <span className="h-2 w-2 rounded-full bg-purple-400/20 animate-float [animation-delay:1s]" />
            </div>
            <p className="text-xs text-gray-600">
              Send a message to start the conversation
            </p>
          </div>
        )}

        {currentMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isStreaming &&
          currentMessages.length > 0 &&
          !currentMessages[currentMessages.length - 1]?.streaming && (
            <div className="flex justify-start mb-4 animate-fade-in">
              <div className="glass-panel rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400/70 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400/40 [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2.5 text-xs text-red-300 animate-slide-up">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500/60 transition-colors hover:text-red-400"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-white/[0.04] px-6 py-4">
        <div className="flex items-end gap-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Shift+Enter for new line)"
            rows={1}
            disabled={isStreaming}
            data-testid="chat-input"
            className="flex-1 resize-none rounded-xl border border-white/[0.06] bg-surface-50/80 px-4 py-3 text-sm text-gray-100 placeholder-gray-600 outline-none transition-all duration-200 focus:border-cyan-500/30 focus:shadow-[0_0_12px_rgba(34,211,238,0.08)] focus:bg-surface-50 disabled:opacity-40"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            data-testid="send-btn"
            className="rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-5 py-3 text-sm font-medium text-white shadow-glow-sm transition-all duration-200 hover:shadow-glow hover:from-cyan-500 hover:to-teal-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
