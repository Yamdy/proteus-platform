// @proteus-ai/server — POST /api/chat synchronous inference endpoint

import type { FastifyInstance } from "fastify";
import type { SessionManager, Harness, AgentContext } from "@proteus-ai/core";

interface ChatBody {
  sessionId: string;
  message: string;
}

export interface ChatRouteDeps {
  sessionManager: SessionManager;
  harness: Harness;
  agent: AgentContext;
}

export async function registerChatRoutes(
  app: FastifyInstance,
  deps: ChatRouteDeps,
): Promise<void> {
  const { sessionManager, harness, agent } = deps;

  app.post<{ Body: ChatBody }>(
    "/",
    async (request, reply) => {
      const { sessionId, message } = request.body ?? {};
      if (!sessionId || !message) {
        return reply.status(400).send({ error: "Bad Request", message: "Body must include sessionId and message" });
      }

      const session = sessionManager.get(sessionId);
      if (!session) {
        return reply.status(404).send({ error: "Not Found", message: `Session "${sessionId}" not found` });
      }

      session.workingMemory.push({ role: "user", content: message });

      try {
        const result = await harness.runTurn(session, agent);
        const messages = session.workingMemory.getMessages();
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
        return reply.send({ turnId: result.turnId, status: result.status, response: lastAssistant?.content ?? "" });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(500).send({ error: "Internal Server Error", message: errMsg });
      }
    },
  );
}
