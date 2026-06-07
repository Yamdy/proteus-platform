// @proteus-ai/server — Session CRUD + SSE streaming routes

import type { FastifyInstance } from "fastify";
import type { SessionManager, SessionConfig, Harness, AgentContext } from "@proteus-ai/core";

interface CreateSessionBody {
  name?: string;
  sessionId?: string;
  config?: SessionConfig;
}

interface SessionParams {
  id: string;
}

interface SessionView {
  id: string;
  name: string;
  createdAt: number;
}

function toSessionView(sessionId: string, config: SessionConfig): SessionView {
  return { id: sessionId, name: config.name ?? sessionId, createdAt: config.createdAt ?? Date.now() };
}

export interface SessionRoutesOptions {
  sessionManager: SessionManager;
  harness?: Harness;
  agent?: AgentContext;
}

export async function sessionRoutes(
  app: FastifyInstance,
  opts: SessionRoutesOptions,
): Promise<void> {
  const { sessionManager, harness, agent } = opts;

  app.post<{ Body: CreateSessionBody }>("/", async (request, reply) => {
    const body = request.body ?? {};
    const sessionId = body.sessionId ?? `sess-${Date.now()}`;
    const config: SessionConfig = body.config ?? {
      sessionId, llm: { provider: "default", model: "default", temperature: 0.7 }, tools: {}, logLevel: "info",
    };
    const enrichedConfig = { ...config, name: body.name ?? sessionId, createdAt: Date.now() };
    try {
      sessionManager.create(sessionId, enrichedConfig);
      return reply.status(201).send(toSessionView(sessionId, enrichedConfig));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("already exists")) return reply.status(409).send({ error: "Conflict", message });
      throw err;
    }
  });

  app.get("/", async () => {
    return sessionManager.list().map((id) => {
      const session = sessionManager.get(id);
      return { id, name: session?.config.name ?? id, createdAt: session?.config.createdAt ?? Date.now() };
    });
  });

  app.get<{ Params: SessionParams }>("/:id", async (request, reply) => {
    const session = sessionManager.get(request.params.id);
    if (!session) return reply.status(404).send({ error: "Not Found" });
    return { id: request.params.id, name: session.config.name ?? request.params.id, createdAt: session.config.createdAt ?? Date.now() };
  });

  app.delete<{ Params: SessionParams }>("/:id", async (request, reply) => {
    if (!sessionManager.get(request.params.id)) return reply.status(404).send({ error: "Not Found" });
    sessionManager.destroy(request.params.id);
    return reply.status(204).send();
  });

  app.get<{ Params: SessionParams }>("/:id/messages", async (request, reply) => {
    const session = sessionManager.get(request.params.id);
    if (!session) return reply.status(404).send({ error: "Not Found" });
    return session.workingMemory.getMessages();
  });

  app.post<{ Params: SessionParams; Body: { content?: string; message?: string } }>(
    "/:id/stream", async (request, reply) => {
      const content = request.body?.content ?? request.body?.message;
      if (!content) return reply.status(400).send({ error: "Bad Request", message: "Body must include 'content'" });
      const session = sessionManager.get(request.params.id);
      if (!session) return reply.status(404).send({ error: "Not Found" });

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
        Connection: "keep-alive", "X-Accel-Buffering": "no",
      });

      if (harness && agent) {
        session.workingMemory.push({ role: "user", content });
        try {
          await harness.runTurn(session, agent, {
            callbacks: { onToken: (token: string) => { reply.raw.write(`data: ${JSON.stringify({ content: token })}\n\n`); } },
          });
        } catch (err: unknown) {
          reply.raw.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" })}\n\n`);
        }
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
        return;
      }

      for (const chunk of (content.match(/.{1,20}/g) ?? [content])) {
        reply.raw.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        await new Promise((r) => setTimeout(r, 50));
      }
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
    },
  );
}
