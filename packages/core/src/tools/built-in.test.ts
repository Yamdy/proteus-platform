import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, unlink, mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReadFileTool, WriteFileTool, ListDirTool, registerBuiltInTools } from "./built-in.js";
import { ToolRegistry } from "../tool-registry.js";

const testDir = join(tmpdir(), `proteus-tools-test-${Date.now()}`);
const testFile = join(testDir, "test.txt");

beforeEach(async () => {
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rmdir(testDir, { recursive: true }).catch(() => {});
});

describe("ReadFileTool", () => {
  it("reads a file", async () => {
    await writeFile(testFile, "hello", "utf-8");
    const tool = new ReadFileTool();
    const result = await tool.execute({ path: testFile }, { turnId: "t1", sessionId: "s1" });
    expect(result.output).toBe("hello");
  });

  it("returns error for missing path", async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute({ path: "" }, { turnId: "t1", sessionId: "s1" });
    expect(result.error?.message).toBe("path is required");
  });

  it("returns error for nonexistent file", async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute({ path: join(testDir, "nope.txt") }, { turnId: "t1", sessionId: "s1" });
    expect(result.error).toBeDefined();
  });
});

describe("WriteFileTool", () => {
  it("writes a file", async () => {
    const tool = new WriteFileTool();
    const result = await tool.execute({ path: testFile, content: "world" }, { turnId: "t1", sessionId: "s1" });
    expect(result.output).toEqual({ written: true, path: testFile });

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(testFile, "utf-8");
    expect(content).toBe("world");
  });

  it("returns error for missing path", async () => {
    const tool = new WriteFileTool();
    const result = await tool.execute({ path: "", content: "x" }, { turnId: "t1", sessionId: "s1" });
    expect(result.error?.message).toBe("path is required");
  });
});

describe("ListDirTool", () => {
  it("lists directory contents", async () => {
    await writeFile(join(testDir, "a.txt"), "a", "utf-8");
    await mkdir(join(testDir, "sub"));

    const tool = new ListDirTool();
    const result = await tool.execute({ path: testDir }, { turnId: "t1", sessionId: "s1" });
    const items = result.output as Array<{ name: string; type: string }>;

    expect(items).toHaveLength(2);
    expect(items.find((i) => i.name === "a.txt")?.type).toBe("file");
    expect(items.find((i) => i.name === "sub")?.type).toBe("directory");
  });

  it("defaults to current directory", async () => {
    const tool = new ListDirTool();
    const result = await tool.execute({}, { turnId: "t1", sessionId: "s1" });
    expect(Array.isArray(result.output)).toBe(true);
  });
});

describe("registerBuiltInTools", () => {
  it("registers all 3 tools", () => {
    const registry = new ToolRegistry();
    registerBuiltInTools(registry);
    expect(registry.has("read_file")).toBe(true);
    expect(registry.has("write_file")).toBe(true);
    expect(registry.has("list_dir")).toBe(true);
  });
});
