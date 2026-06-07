import { create } from "zustand";

export interface Session {
  id: string;
  name: string;
  createdAt: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  streaming?: boolean;
}

interface SessionState {
  sessions: Session[];
  currentSession: Session | null;
  messages: Record<string, Message[]>;
  streamingSessions: Set<string>;

  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  removeSession: (id: string) => void;
  setCurrentSession: (session: Session | null) => void;

  addMessage: (sessionId: string, message: Message) => void;
  appendToMessage: (sessionId: string, messageId: string, chunk: string) => void;
  setMessageStreaming: (sessionId: string, messageId: string, streaming: boolean) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;

  setSessionStreaming: (sessionId: string, streaming: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  currentSession: null,
  messages: {},
  streamingSessions: new Set<string>(),

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) =>
    set((state) => ({ sessions: [...state.sessions, session] })),

  removeSession: (id) =>
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== id);
      const { [id]: _, ...restMessages } = state.messages;
      const nextStreaming = new Set(state.streamingSessions);
      nextStreaming.delete(id);
      return {
        sessions: remaining,
        messages: restMessages,
        streamingSessions: nextStreaming,
        currentSession:
          state.currentSession?.id === id
            ? remaining[remaining.length - 1] ?? null
            : state.currentSession,
      };
    }),

  setCurrentSession: (session) => set({ currentSession: session }),

  addMessage: (sessionId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: [...(state.messages[sessionId] ?? []), message],
      },
    })),

  appendToMessage: (sessionId, messageId, chunk) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: (state.messages[sessionId] ?? []).map((m) =>
          m.id === messageId ? { ...m, content: m.content + chunk } : m,
        ),
      },
    })),

  setMessageStreaming: (sessionId, messageId, streaming) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: (state.messages[sessionId] ?? []).map((m) =>
          m.id === messageId ? { ...m, streaming } : m,
        ),
      },
    })),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: messages,
      },
    })),

  setSessionStreaming: (sessionId, streaming) =>
    set((state) => {
      const next = new Set(state.streamingSessions);
      if (streaming) next.add(sessionId);
      else next.delete(sessionId);
      return { streamingSessions: next };
    }),
}));
