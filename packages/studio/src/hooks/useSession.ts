import { useCallback } from "react";
import { useSessionStore, type Session } from "../stores/sessionStore";
import { apiFetch } from "../lib/api";

const API_BASE = "/api/sessions";

export function useSession() {
  const {
    sessions,
    currentSession,
    setSessions,
    addSession,
    removeSession,
    setCurrentSession,
    setMessages,
  } = useSessionStore();

  const fetchSessions = useCallback(async () => {
    const data = await apiFetch<Session[]>(API_BASE);
    setSessions(data);
  }, [setSessions]);

  const createSession = useCallback(
    async (name?: string) => {
      const session = await apiFetch<Session>(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      addSession(session);
      setCurrentSession(session);
      return session;
    },
    [addSession, setCurrentSession],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      await apiFetch(`${API_BASE}/${id}`, { method: "DELETE" });
      removeSession(id);
    },
    [removeSession],
  );

  const fetchMessages = useCallback(
    async (sessionId: string) => {
      const data = await apiFetch<Array<{ role: string; content: string }>>(
        `${API_BASE}/${sessionId}/messages`,
      );
      const messages = data.map((msg, i) => ({
        id: `hist-${sessionId}-${i}`,
        sessionId,
        role: msg.role as "user" | "assistant",
        content: msg.content,
        timestamp: Date.now() - (data.length - i) * 60000,
      }));
      setMessages(sessionId, messages);
    },
    [setMessages],
  );

  return {
    sessions,
    currentSession,
    fetchSessions,
    createSession,
    deleteSession,
    fetchMessages,
    setCurrentSession,
  };
}
