import { describe, it, expect } from "vitest";
import { useSessionStore } from "./stores/sessionStore";
import { useConnectionStore } from "./stores/connectionStore";

describe("sessionStore", () => {
  it("should initialize with empty state", () => {
    const state = useSessionStore.getState();
    expect(state.sessions).toEqual([]);
    expect(state.currentSession).toBeNull();
    expect(state.messages).toEqual({});
    expect(state.streamingSessions.size).toBe(0);
  });

  it("should add a session", () => {
    const { addSession } = useSessionStore.getState();
    addSession({ id: "sess-1", name: "Test", createdAt: Date.now() });
    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].id).toBe("sess-1");
  });

  it("should set current session", () => {
    const session = { id: "sess-1", name: "Test", createdAt: Date.now() };
    useSessionStore.getState().setCurrentSession(session);
    expect(useSessionStore.getState().currentSession?.id).toBe("sess-1");
  });

  it("should add a message", () => {
    const { addMessage } = useSessionStore.getState();
    addMessage("sess-1", {
      id: "msg-1",
      sessionId: "sess-1",
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    });
    const messages = useSessionStore.getState().messages["sess-1"];
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("hello");
  });

  it("should append to a message", () => {
    const { appendToMessage } = useSessionStore.getState();
    appendToMessage("sess-1", "msg-1", " world");
    const messages = useSessionStore.getState().messages["sess-1"];
    expect(messages[0].content).toBe("hello world");
  });

  it("should remove a session", () => {
    const { removeSession } = useSessionStore.getState();
    removeSession("sess-1");
    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(0);
    expect(state.messages["sess-1"]).toBeUndefined();
  });

  it("should track streaming per session independently", () => {
    const { addSession, setSessionStreaming } = useSessionStore.getState();
    addSession({ id: "s-a", name: "A", createdAt: Date.now() });
    addSession({ id: "s-b", name: "B", createdAt: Date.now() });

    setSessionStreaming("s-a", true);
    expect(useSessionStore.getState().streamingSessions.has("s-a")).toBe(true);
    expect(useSessionStore.getState().streamingSessions.has("s-b")).toBe(false);

    setSessionStreaming("s-a", false);
    expect(useSessionStore.getState().streamingSessions.has("s-a")).toBe(false);
  });

  it("should clean up streamingSessions on remove", () => {
    useSessionStore.getState().setSessionStreaming("s-b", true);
    useSessionStore.getState().removeSession("s-b");
    expect(useSessionStore.getState().streamingSessions.has("s-b")).toBe(false);
  });
});

describe("connectionStore", () => {
  it("should initialize disconnected", () => {
    const state = useConnectionStore.getState();
    expect(state.connected).toBe(false);
    expect(state.reconnecting).toBe(false);
  });

  it("should connect", () => {
    useConnectionStore.getState().connect();
    expect(useConnectionStore.getState().connected).toBe(true);
  });

  it("should disconnect", () => {
    useConnectionStore.getState().disconnect();
    expect(useConnectionStore.getState().connected).toBe(false);
  });
});
