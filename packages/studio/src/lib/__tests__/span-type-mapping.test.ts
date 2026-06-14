import { describe, it, expect } from "vitest";
import {
  getSpanTypeUi,
  spanTypePrefixes,
  usedSpanTypes,
  spanTypeMappings,
} from "../span-type-mapping.js";
import type { UISpan } from "../span-type-mapping.js";

describe("spanTypeMappings", () => {
  it("contains exactly 8 entries", () => {
    expect(spanTypeMappings).toHaveLength(8);
  });

  const expectedTypes = [
    { typePrefix: "chain", color: "oklch(0.6 0.2 250)", label: "Chain" },
    { typePrefix: "turn", color: "oklch(0.6 0.2 300)", label: "Turn" },
    { typePrefix: "phase", color: "oklch(0.6 0.2 200)", label: "Phase" },
    { typePrefix: "model", color: "oklch(0.6 0.2 170)", label: "Model" },
    { typePrefix: "tool", color: "oklch(0.6 0.2 80)", label: "Tool" },
    { typePrefix: "gate", color: "oklch(0.6 0.2 340)", label: "Gate" },
    { typePrefix: "processor", color: "oklch(0.6 0.2 270)", label: "Processor" },
    { typePrefix: "other", color: "oklch(0.5 0.05 0)", label: "Other" },
  ];

  for (const expected of expectedTypes) {
    it(`${expected.typePrefix} mapping has correct color and label`, () => {
      const mapping = spanTypeMappings.find((m) => m.typePrefix === expected.typePrefix);
      expect(mapping).toBeDefined();
      expect(mapping!.color).toBe(expected.color);
      expect(mapping!.label).toBe(expected.label);
      expect(mapping!.icon).toBeDefined();
    });
  }
});

describe("spanTypePrefixes", () => {
  it("has 8 entries", () => {
    expect(spanTypePrefixes).toHaveLength(8);
  });

  it("contains all expected prefixes", () => {
    const expected = ["chain", "turn", "phase", "model", "tool", "gate", "processor", "other"];
    expect([...spanTypePrefixes]).toEqual(expected);
  });
});

describe("getSpanTypeUi", () => {
  it("returns chain config for 'chain_abc'", () => {
    const result = getSpanTypeUi("chain_abc");
    expect(result.typePrefix).toBe("chain");
    expect(result.color).toBe("oklch(0.6 0.2 250)");
    expect(result.label).toBe("Chain");
    expect(result.icon).toBeDefined();
  });

  it("returns turn config for 'turn_123'", () => {
    const result = getSpanTypeUi("turn_123");
    expect(result.typePrefix).toBe("turn");
    expect(result.label).toBe("Turn");
  });

  it("returns phase config for 'phase_llm_inference'", () => {
    const result = getSpanTypeUi("phase_llm_inference");
    expect(result.typePrefix).toBe("phase");
    expect(result.label).toBe("Phase");
  });

  it("returns model config for 'model_call'", () => {
    const result = getSpanTypeUi("model_call");
    expect(result.typePrefix).toBe("model");
    expect(result.label).toBe("Model");
  });

  it("returns tool config for 'tool_search'", () => {
    const result = getSpanTypeUi("tool_search");
    expect(result.typePrefix).toBe("tool");
    expect(result.label).toBe("Tool");
  });

  it("returns gate config for 'gate_validate'", () => {
    const result = getSpanTypeUi("gate_validate");
    expect(result.typePrefix).toBe("gate");
    expect(result.label).toBe("Gate");
  });

  it("returns processor config for 'processor_parse'", () => {
    const result = getSpanTypeUi("processor_parse");
    expect(result.typePrefix).toBe("processor");
    expect(result.label).toBe("Processor");
  });

  it("returns other config for 'unknown_xyz'", () => {
    const result = getSpanTypeUi("unknown_xyz");
    expect(result.typePrefix).toBe("other");
    expect(result.color).toBe("oklch(0.5 0.05 0)");
    expect(result.label).toBe("Other");
  });

  it("returns other config for 'other'", () => {
    const result = getSpanTypeUi("other");
    expect(result.typePrefix).toBe("other");
    expect(result.label).toBe("Other");
  });

  it("returns other config for empty string", () => {
    const result = getSpanTypeUi("");
    expect(result.typePrefix).toBe("other");
    expect(result.label).toBe("Other");
  });

  it("returns other config for type with no underscore", () => {
    const result = getSpanTypeUi("randomtype");
    expect(result.typePrefix).toBe("other");
    expect(result.label).toBe("Other");
  });
});

describe("usedSpanTypes", () => {
  it("returns empty set for empty roots", () => {
    expect(usedSpanTypes([]).size).toBe(0);
  });

  it("collects type prefix from a single span", () => {
    const roots: UISpan[] = [{ id: "1", type: "chain_start", name: "c1" }];
    const result = usedSpanTypes(roots);
    expect(result.has("chain")).toBe(true);
    expect(result.size).toBe(1);
  });

  it("collects distinct prefixes from siblings", () => {
    const roots: UISpan[] = [
      { id: "1", type: "chain_start", name: "c1" },
      { id: "2", type: "turn_start", name: "t1" },
      { id: "3", type: "tool_call", name: "tc1" },
    ];
    const result = usedSpanTypes(roots);
    expect(result.has("chain")).toBe(true);
    expect(result.has("turn")).toBe(true);
    expect(result.has("tool")).toBe(true);
    expect(result.size).toBe(3);
  });

  it("recursively collects from nested children", () => {
    const roots: UISpan[] = [
      {
        id: "1",
        type: "chain_start",
        name: "c1",
        children: [
          {
            id: "2",
            type: "turn_start",
            name: "t1",
            children: [
              { id: "3", type: "model_call", name: "m1" },
              { id: "4", type: "tool_call", name: "tc1" },
            ],
          },
        ],
      },
    ];
    const result = usedSpanTypes(roots);
    expect(result.has("chain")).toBe(true);
    expect(result.has("turn")).toBe(true);
    expect(result.has("model")).toBe(true);
    expect(result.has("tool")).toBe(true);
    expect(result.size).toBe(4);
  });

  it("deduplicates same prefix appearing multiple times", () => {
    const roots: UISpan[] = [
      { id: "1", type: "tool_a", name: "t1" },
      {
        id: "2",
        type: "chain_start",
        name: "c1",
        children: [
          { id: "3", type: "tool_b", name: "t2" },
          { id: "4", type: "tool_c", name: "t3" },
        ],
      },
    ];
    const result = usedSpanTypes(roots);
    expect(result.has("tool")).toBe(true);
    expect(result.has("chain")).toBe(true);
    expect(result.size).toBe(2);
  });

  it("maps unknown prefixes to 'other'", () => {
    const roots: UISpan[] = [
      { id: "1", type: "unknown_something", name: "u1" },
    ];
    const result = usedSpanTypes(roots);
    expect(result.has("other")).toBe(true);
    expect(result.size).toBe(1);
  });
});
