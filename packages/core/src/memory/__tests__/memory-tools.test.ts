import { describe, it, expect, beforeEach, vi } from "vitest";
import { RecallTool } from "../tools/recall-tool.js";
import { StoreMemoryTool } from "../tools/store-memory-tool.js";
import { createMemoryTools } from "../tools/index.js";
import type { MemoryProvider, SemanticSearchResult } from "../types.js";
import type { SemanticRecall } from "../semantic-recall.js";
import type { HandlerEngineHandle } from "../../context.js";
import type { ToolContext } from "../../types.js";

// --- Helpers ---

function makeContext(): ToolContext {
  return { turnId: "turn-1", sessionId: "session-1" };
}

function makeSemanticRecall(results: SemanticSearchResult[]): SemanticRecall {
  return { search: vi.fn().mockResolvedValue(results), store: vi.fn().mockResolvedValue(undefined) } as unknown as SemanticRecall;
}

function makeMemoryProvider(): MemoryProvider {
  return {
    addEntry: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    deleteEntry: vi.fn(),
    clearHistory: vi.fn(),
    getWorkingMemory: vi.fn().mockReturnValue({}),
    setWorkingMemory: vi.fn(),
    mergeWorkingMemory: vi.fn(),
    createThread: vi.fn(),
    getThread: vi.fn().mockReturnValue(undefined),
    listThreads: vi.fn().mockReturnValue([]),
    deleteThread: vi.fn(),
    cloneThread: vi.fn().mockReturnValue(undefined),
  };
}

function makeHandlerEngine(): HandlerEngineHandle {
  return {
    getHandlers: vi.fn().mockReturnValue([]),
    emit: vi.fn().mockResolvedValue([]),
  };
}

// --- RecallTool tests ---

describe("RecallTool", () => {
  let semanticRecall: SemanticRecall;
  let handlerEngine: HandlerEngineHandle;
  let tool: RecallTool;

  beforeEach(() => {
    semanticRecall = makeSemanticRecall([
      { entry: { role: "user", content: "first" }, score: 0.95 },
      { entry: { role: "user", content: "second" }, score: 0.85 },
    ]);
    handlerEngine = makeHandlerEngine();
    tool = new RecallTool({ semanticRecall, handlerEngine });
  });

  describe("definition", () => {
    it("has name 'recall'", () => {
      expect(tool.definition.name).toBe("recall");
    });

    it("has a description", () => {
      expect(tool.definition.description).toBeTruthy();
      expect(typeof tool.definition.description).toBe("string");
    });
  });

  describe("execute", () => {
    it("returns matching entries as content", async () => {
      const result = await tool.execute({ query: "test query" }, makeContext());

      expect(result.output).toBeDefined();
      expect(Array.isArray(result.output)).toBe(true);
      expect((result.output as SemanticSearchResult[])).toHaveLength(2);
      expect((result.output as SemanticSearchResult[])[0].entry.content).toBe("first");
    });

    it("passes query and topK to semanticRecall.search", async () => {
      await tool.execute({ query: "hello world", topK: 5 }, makeContext());

      expect(semanticRecall.search).toHaveBeenCalledWith("session-1", "hello world", 5);
    });

    it("defaults topK to undefined when not provided", async () => {
      await tool.execute({ query: "hello" }, makeContext());

      expect(semanticRecall.search).toHaveBeenCalledWith("session-1", "hello", undefined);
    });

    it("returns empty array when no results found", async () => {
      (semanticRecall.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await tool.execute({ query: "no matches" }, makeContext());

      expect(result.output).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it("emits a memory:recall event", async () => {
      await tool.execute({ query: "test" }, makeContext());

      expect(handlerEngine.emit).toHaveBeenCalledWith("memory:recall", expect.objectContaining({
        query: "test",
        sessionId: "session-1",
        resultCount: 2,
      }));
    });
  });
});

// --- StoreMemoryTool tests ---

describe("StoreMemoryTool", () => {
  let provider: MemoryProvider;
  let handlerEngine: HandlerEngineHandle;
  let tool: StoreMemoryTool;

  beforeEach(() => {
    provider = makeMemoryProvider();
    handlerEngine = makeHandlerEngine();
    tool = new StoreMemoryTool({ provider, handlerEngine });
  });

  describe("definition", () => {
    it("has name 'store_memory'", () => {
      expect(tool.definition.name).toBe("store_memory");
    });

    it("has a description", () => {
      expect(tool.definition.description).toBeTruthy();
      expect(typeof tool.definition.description).toBe("string");
    });
  });

  describe("execute", () => {
    it("calls provider.addEntry with content", async () => {
      await tool.execute({ content: "remember this" }, makeContext());

      expect(provider.addEntry).toHaveBeenCalledWith("session-1", expect.objectContaining({
        role: "user",
        content: "remember this",
      }));
    });

    it("passes metadata to provider.addEntry", async () => {
      const metadata = { source: "user", importance: "high" };
      await tool.execute({ content: "important fact", metadata }, makeContext());

      expect(provider.addEntry).toHaveBeenCalledWith("session-1", expect.objectContaining({
        content: "important fact",
        metadata,
      }));
    });

    it("returns confirmation with stored entry", async () => {
      const result = await tool.execute({ content: "stored content" }, makeContext());

      expect(result.output).toBeDefined();
      expect(result.output).toEqual(expect.objectContaining({ content: "stored content" }));
      expect(result.error).toBeUndefined();
    });

    it("emits a memory:store event", async () => {
      await tool.execute({ content: "test", metadata: { key: "val" } }, makeContext());

      expect(handlerEngine.emit).toHaveBeenCalledWith("memory:store", expect.objectContaining({
        entryId: expect.any(String),
        sessionId: "session-1",
      }));
    });
  });
});

// --- createMemoryTools tests ---

describe("createMemoryTools", () => {
  it("returns an array of two tools", () => {
    const tools = createMemoryTools(
      makeMemoryProvider(),
      makeSemanticRecall([]),
      makeHandlerEngine(),
    );

    expect(tools).toHaveLength(2);
  });

  it("returns recall and store_memory tools", () => {
    const tools = createMemoryTools(
      makeMemoryProvider(),
      makeSemanticRecall([]),
      makeHandlerEngine(),
    );

    const names = tools.map((t) => t.definition.name).sort();
    expect(names).toEqual(["recall", "store_memory"]);
  });

  it("returned tools implement the Tool interface", () => {
    const tools = createMemoryTools(
      makeMemoryProvider(),
      makeSemanticRecall([]),
      makeHandlerEngine(),
    );

    for (const tool of tools) {
      expect(tool.definition).toBeDefined();
      expect(typeof tool.definition.name).toBe("string");
      expect(typeof tool.definition.description).toBe("string");
      expect(typeof tool.execute).toBe("function");
    }
  });
});
