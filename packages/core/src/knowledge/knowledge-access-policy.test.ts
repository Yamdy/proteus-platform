import { describe, it, expect } from "vitest";
import {
  AllowAllPolicy,
  DenyTagPolicy,
  OwnerOnlyWritePolicy,
  CompositePolicy,
} from "./knowledge-access-policy.js";
import type { KnowledgeEntry } from "../types.js";

const makeEntry = (overrides?: Partial<KnowledgeEntry>): KnowledgeEntry => ({
  id: "test-id",
  key: "test/key",
  value: "test",
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe("AllowAllPolicy", () => {
  it("should allow all operations", () => {
    const policy = new AllowAllPolicy();
    expect(policy.check({ agentId: "a", mode: "read" }).allowed).toBe(true);
    expect(policy.check({ agentId: "a", mode: "write" }).allowed).toBe(true);
    expect(policy.check({ agentId: "a", mode: "delete" }).allowed).toBe(true);
  });
});

describe("DenyTagPolicy", () => {
  const policy = new DenyTagPolicy(["restricted", "secret"]);

  it("should deny entries with denied tags", () => {
    const entry = makeEntry({ tags: ["restricted"] });
    const result = policy.check({ agentId: "a", mode: "read", entry });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("restricted");
  });

  it("should allow entries without denied tags", () => {
    const entry = makeEntry({ tags: ["public"] });
    const result = policy.check({ agentId: "a", mode: "read", entry });
    expect(result.allowed).toBe(true);
  });

  it("should allow when no entry provided", () => {
    const result = policy.check({ agentId: "a", mode: "read" });
    expect(result.allowed).toBe(true);
  });
});

describe("OwnerOnlyWritePolicy", () => {
  const policy = new OwnerOnlyWritePolicy();

  it("should allow reads regardless of ownership", () => {
    const entry = makeEntry({ agentId: "other-agent" });
    const result = policy.check({ agentId: "my-agent", mode: "read", entry });
    expect(result.allowed).toBe(true);
  });

  it("should deny writes from non-owner", () => {
    const entry = makeEntry({ agentId: "owner-agent" });
    const result = policy.check({ agentId: "other-agent", mode: "write", entry });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not the owner");
  });

  it("should deny deletes from non-owner", () => {
    const entry = makeEntry({ agentId: "owner-agent" });
    const result = policy.check({ agentId: "other-agent", mode: "delete", entry });
    expect(result.allowed).toBe(false);
  });

  it("should allow writes from owner", () => {
    const entry = makeEntry({ agentId: "my-agent" });
    const result = policy.check({ agentId: "my-agent", mode: "write", entry });
    expect(result.allowed).toBe(true);
  });

  it("should allow writes when entry has no agentId", () => {
    const entry = makeEntry({ agentId: undefined });
    const result = policy.check({ agentId: "any", mode: "write", entry });
    expect(result.allowed).toBe(true);
  });
});

describe("CompositePolicy", () => {
  it("should allow when all policies pass", () => {
    const policy = new CompositePolicy([new AllowAllPolicy()]);
    const result = policy.check({ agentId: "a", mode: "read" });
    expect(result.allowed).toBe(true);
  });

  it("should deny on first failing policy", () => {
    const policy = new CompositePolicy([
      new AllowAllPolicy(),
      new DenyTagPolicy(["secret"]),
    ]);
    const entry = makeEntry({ tags: ["secret"] });
    const result = policy.check({ agentId: "a", mode: "read", entry });
    expect(result.allowed).toBe(false);
  });

  it("should compose owner + deny-tag policies", () => {
    const policy = new CompositePolicy([
      new OwnerOnlyWritePolicy(),
      new DenyTagPolicy(["restricted"]),
    ]);

    // Owner can write to non-restricted entries
    const entry1 = makeEntry({ agentId: "a", tags: ["public"] });
    expect(policy.check({ agentId: "a", mode: "write", entry: entry1 }).allowed).toBe(true);

    // Non-owner cannot write
    const entry2 = makeEntry({ agentId: "b", tags: ["public"] });
    expect(policy.check({ agentId: "a", mode: "write", entry: entry2 }).allowed).toBe(false);

    // Owner cannot write to restricted entries
    const entry3 = makeEntry({ agentId: "a", tags: ["restricted"] });
    expect(policy.check({ agentId: "a", mode: "write", entry: entry3 }).allowed).toBe(false);
  });
});
