import { describe, it, expect, beforeEach } from "vitest";
import type { ProteusSpan, ProteusTracer, ProteusMetric } from "./types.js";
import { OTelBridgeHandler } from "./otel-bridge.js";

// --- Mock tracer (same pattern as cross-agent-trace.test.ts) ---

let spanCounter = 0;

class MockSpan implements ProteusSpan {
  readonly name: string;
  readonly spanId: string;
  readonly traceId: string;
  readonly startTime: number;
  readonly attributes: Record<string, string | number | boolean> = {};
  private _status?: { code: "ok" | "error"; message?: string };
  private _ended = false;

  constructor(name: string, parent?: MockSpan, attributes?: Record<string, string | number | boolean>) {
    this.name = name;
    this.spanId = `span-${++spanCounter}`;
    this.traceId = parent?.traceId ?? `trace-${spanCounter}`;
    this.startTime = Date.now();
    if (attributes) Object.assign(this.attributes, attributes);
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value;
  }

  setStatus(code: "ok" | "error", message?: string): void {
    this._status = { code, message };
  }

  end(): void {
    this._ended = true;
  }

  get ended(): boolean { return this._ended; }
  get status() { return this._status; }
}

class MockTracer implements ProteusTracer {
  readonly spans: MockSpan[] = [];
  private activeSpan?: MockSpan;

  startSpan(name: string, parent?: ProteusSpan, attributes?: Record<string, string | number | boolean>): ProteusSpan {
    const span = new MockSpan(name, parent as MockSpan | undefined, attributes);
    this.spans.push(span);
    this.activeSpan = span;
    return span;
  }

  getActiveSpan(): ProteusSpan | undefined {
    return this.activeSpan;
  }
}

class MockMetric implements ProteusMetric {
  readonly counters = new Map<string, number>();
  readonly histograms: Array<{ name: string; value: number; attributes?: Record<string, string> }> = [];
  readonly gauges = new Map<string, number>();

  incrementCounter(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  recordHistogram(name: string, value: number, attributes?: Record<string, string>): void {
    this.histograms.push({ name, value, attributes });
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }
}

describe("OTelBridgeHandler — span payload attributes", () => {
  let tracer: MockTracer;
  let metric: MockMetric;
  let bridge: OTelBridgeHandler;

  beforeEach(() => {
    spanCounter = 0;
    tracer = new MockTracer();
    metric = new MockMetric();
    bridge = new OTelBridgeHandler(tracer, metric);
  });

  // --- context_assembly: system prompt ---

  describe("context_assembly — system prompt", () => {
    it("sets context.system_prompt from payload.systemPrompt", () => {
      bridge.handlePhaseBefore({
        phaseName: "context_assembly",
        session: { sessionId: "s1" },
        payload: { systemPrompt: "You are a helpful assistant." },
      });

      const span = tracer.spans[0]!;
      expect(span.attributes["context.system_prompt"]).toBe("You are a helpful assistant.");
    });

    it("caps system prompt at 2000 characters", () => {
      const longPrompt = "x".repeat(3000);
      bridge.handlePhaseBefore({
        phaseName: "context_assembly",
        session: { sessionId: "s1" },
        payload: { systemPrompt: longPrompt },
      });

      const span = tracer.spans[0]!;
      expect(String(span.attributes["context.system_prompt"])).toHaveLength(2000);
    });

    it("does not set attribute when systemPrompt is missing", () => {
      bridge.handlePhaseBefore({
        phaseName: "context_assembly",
        session: { sessionId: "s1" },
      });

      const span = tracer.spans[0]!;
      expect(span.attributes["context.system_prompt"]).toBeUndefined();
    });

    it("does not set attribute for non-context_assembly phases", () => {
      bridge.handlePhaseBefore({
        phaseName: "llm_inference",
        session: { sessionId: "s1" },
        payload: { systemPrompt: "ignored" },
      });

      const span = tracer.spans[0]!;
      expect(span.attributes["context.system_prompt"]).toBeUndefined();
    });
  });

  // --- tool_execution: tool calls ---

  describe("tool_execution — tool calls", () => {
    beforeEach(() => {
      // Start a phase span so handlePhaseAfter has something to work with
      bridge.handlePhaseBefore({
        phaseName: "tool_execution",
        session: { sessionId: "s1" },
      });
    });

    it("sets tool.calls_count and per-call attributes", () => {
      bridge.handlePhaseAfter({
        phaseName: "tool_execution",
        session: { sessionId: "s1" },
        payload: {
          toolCalls: [
            { name: "search", input: { q: "test" }, output: { results: [1] }, success: true },
            { name: "read", input: { path: "/f" }, output: { content: "hi" }, success: false },
          ],
        },
      });

      const span = tracer.spans[0]!; // phase span
      expect(span.attributes["tool.calls_count"]).toBe(2);
      expect(span.attributes["tool.0.name"]).toBe("search");
      expect(span.attributes["tool.0.input"]).toBe('{"q":"test"}');
      expect(span.attributes["tool.0.output"]).toBe('{"results":[1]}');
      expect(span.attributes["tool.0.success"]).toBe(true);
      expect(span.attributes["tool.1.name"]).toBe("read");
      expect(span.attributes["tool.1.input"]).toBe('{"path":"/f"}');
      expect(span.attributes["tool.1.output"]).toBe('{"content":"hi"}');
      expect(span.attributes["tool.1.success"]).toBe(false);
    });

    it("caps tool input/output JSON at 1000 characters", () => {
      const bigObj = { data: "y".repeat(2000) };
      bridge.handlePhaseAfter({
        phaseName: "tool_execution",
        session: { sessionId: "s1" },
        payload: {
          toolCalls: [
            { name: "big", input: bigObj, output: bigObj, success: true },
          ],
        },
      });

      const span = tracer.spans[0]!;
      expect(String(span.attributes["tool.0.input"])).toHaveLength(1000);
      expect(String(span.attributes["tool.0.output"])).toHaveLength(1000);
    });

    it("sets calls_count to 0 for empty toolCalls array", () => {
      bridge.handlePhaseAfter({
        phaseName: "tool_execution",
        session: { sessionId: "s1" },
        payload: { toolCalls: [] },
      });

      const span = tracer.spans[0]!;
      expect(span.attributes["tool.calls_count"]).toBe(0);
    });

    it("does not set tool attributes when payload is missing", () => {
      bridge.handlePhaseAfter({
        phaseName: "tool_execution",
        session: { sessionId: "s1" },
      });

      const span = tracer.spans[0]!;
      expect(span.attributes["tool.calls_count"]).toBeUndefined();
    });

    it("skips optional fields when not provided", () => {
      bridge.handlePhaseAfter({
        phaseName: "tool_execution",
        session: { sessionId: "s1" },
        payload: {
          toolCalls: [
            { name: "minimal" },
          ],
        },
      });

      const span = tracer.spans[0]!;
      expect(span.attributes["tool.0.name"]).toBe("minimal");
      expect(span.attributes["tool.0.input"]).toBeUndefined();
      expect(span.attributes["tool.0.output"]).toBeUndefined();
      expect(span.attributes["tool.0.success"]).toBeUndefined();
    });
  });

  // --- llm_inference: usage tokens ---

  describe("llm_inference — usage tokens", () => {
    beforeEach(() => {
      bridge.handlePhaseBefore({
        phaseName: "llm_inference",
        session: { sessionId: "s1" },
      });
    });

    it("sets llm.input_tokens and llm.output_tokens from payload.usage", () => {
      bridge.handlePhaseAfter({
        phaseName: "llm_inference",
        session: { sessionId: "s1" },
        payload: { usage: { input_tokens: 150, output_tokens: 42 } },
      });

      const span = tracer.spans[0]!;
      expect(span.attributes["llm.input_tokens"]).toBe(150);
      expect(span.attributes["llm.output_tokens"]).toBe(42);
    });

    it("does not set token attributes when usage is missing", () => {
      bridge.handlePhaseAfter({
        phaseName: "llm_inference",
        session: { sessionId: "s1" },
      });

      const span = tracer.spans[0]!;
      expect(span.attributes["llm.input_tokens"]).toBeUndefined();
      expect(span.attributes["llm.output_tokens"]).toBeUndefined();
    });

    it("handles partial usage (only input_tokens)", () => {
      bridge.handlePhaseAfter({
        phaseName: "llm_inference",
        session: { sessionId: "s1" },
        payload: { usage: { input_tokens: 100 } },
      });

      const span = tracer.spans[0]!;
      expect(span.attributes["llm.input_tokens"]).toBe(100);
      expect(span.attributes["llm.output_tokens"]).toBeUndefined();
    });

    it("records llm.latency histogram", () => {
      bridge.handlePhaseAfter({
        phaseName: "llm_inference",
        session: { sessionId: "s1" },
      });

      const latencies = metric.histograms.filter(h => h.name === "proteus.llm.latency");
      expect(latencies).toHaveLength(1);
    });
  });

  // --- existing behavior unchanged ---

  describe("existing behavior", () => {
    it("handleChainStart/End still works", () => {
      bridge.handleChainStart({ chainId: "c1", sessionId: "s1" });
      expect(tracer.spans).toHaveLength(1);
      expect(tracer.spans[0]!.name).toBe("chain");
      expect(tracer.spans[0]!.attributes["chain.id"]).toBe("c1");

      bridge.handleChainEnd({ chainId: "c1", sessionId: "s1", status: "ok" });
      expect(tracer.spans[0]!.ended).toBe(true);
      expect(tracer.spans[0]!.status).toEqual({ code: "ok" });
    });

    it("handleTurnStart/End still works", () => {
      bridge.handleTurnStart({ turnId: "t1", sessionId: "s1" });
      expect(tracer.spans).toHaveLength(1);
      expect(tracer.spans[0]!.name).toBe("turn");

      bridge.handleTurnEnd({ turnId: "t1", sessionId: "s1", status: "ok" });
      expect(tracer.spans[0]!.ended).toBe(true);
    });

    it("handlePhaseBefore/End without payload still works", () => {
      bridge.handlePhaseBefore({ phaseName: "action_resolution", session: { sessionId: "s1" } });
      expect(tracer.spans).toHaveLength(1);
      expect(tracer.spans[0]!.name).toBe("phase:action_resolution");

      bridge.handlePhaseAfter({ phaseName: "action_resolution", session: { sessionId: "s1" } });
      expect(tracer.spans[0]!.ended).toBe(true);
      expect(tracer.spans[0]!.status).toEqual({ code: "ok" });
    });
  });
});
