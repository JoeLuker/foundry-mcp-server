import { describe, it, expect } from "vitest";
import {
  pickFields,
  applyClientFilters,
  filterByName,
  splitFilters,
  jsonResponse,
  errorResponse,
  getFirstResult,
  getResults,
  rollDice,
} from "./utils.js";
import type { DocumentSocketResponse } from "./types.js";

// ── pickFields ──────────────────────────────────────────────────────

describe("pickFields", () => {
  const doc = {
    _id: "abc123",
    name: "Test Actor",
    type: "character",
    system: {
      attributes: {
        hp: { value: 30, max: 50 },
        init: { total: 5 },
      },
      details: { level: 10 },
    },
    folder: null,
  };

  it("returns the full document when no fields specified", () => {
    expect(pickFields(doc)).toBe(doc);
    expect(pickFields(doc, [])).toBe(doc);
  });

  it("picks top-level fields", () => {
    const result = pickFields(doc, ["_id", "name"]);
    expect(result).toEqual({ _id: "abc123", name: "Test Actor" });
  });

  it("picks dot-notation nested fields", () => {
    const result = pickFields(doc, ["system.attributes.hp.value"]);
    expect(result).toEqual({ "system.attributes.hp.value": 30 });
  });

  it("returns undefined for missing nested paths", () => {
    const result = pickFields(doc, ["system.nonexistent.field"]);
    expect(result).toEqual({ "system.nonexistent.field": undefined });
  });

  it("returns undefined for missing top-level fields", () => {
    const result = pickFields(doc, ["missing"]);
    expect(result).toEqual({ missing: undefined });
  });

  it("handles mixed top-level and nested fields", () => {
    const result = pickFields(doc, ["_id", "system.details.level"]);
    expect(result).toEqual({ _id: "abc123", "system.details.level": 10 });
  });

  it("handles null values in the path", () => {
    const result = pickFields(doc, ["folder"]);
    expect(result).toEqual({ folder: null });
  });
});

// ── applyClientFilters ──────────────────────────────────────────────

describe("applyClientFilters", () => {
  const docs = [
    { _id: "1", name: "Sword", system: { type: "weapon", cost: 50 } },
    { _id: "2", name: "Shield", system: { type: "armor", cost: 30 } },
    { _id: "3", name: "Axe", system: { type: "weapon", cost: 75 } },
  ];

  it("returns all docs when no filters", () => {
    expect(applyClientFilters(docs, {})).toBe(docs);
  });

  it("filters by dot-notation path", () => {
    const result = applyClientFilters(docs, { "system.type": "weapon" });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.name)).toEqual(["Sword", "Axe"]);
  });

  it("filters by multiple criteria (AND)", () => {
    const result = applyClientFilters(docs, {
      "system.type": "weapon",
      "system.cost": 75,
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Axe");
  });

  it("returns empty array when no match", () => {
    const result = applyClientFilters(docs, { "system.type": "potion" });
    expect(result).toHaveLength(0);
  });

  it("handles missing nested paths", () => {
    const result = applyClientFilters(docs, { "system.weight": 10 });
    expect(result).toHaveLength(0);
  });
});

// ── filterByName ────────────────────────────────────────────────────

describe("filterByName", () => {
  const docs = [
    { _id: "1", name: "Longsword" },
    { _id: "2", name: "Shortsword" },
    { _id: "3", name: "Dagger" },
    { _id: "4", name: "Longbow" },
  ];

  it("filters by substring (case-insensitive)", () => {
    const result = filterByName(docs, "sword");
    expect(result).toHaveLength(2);
  });

  it("filters by regex pattern", () => {
    const result = filterByName(docs, "^Long");
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.name)).toEqual(["Longsword", "Longbow"]);
  });

  it("falls back to substring on invalid regex", () => {
    const result = filterByName(docs, "[invalid");
    expect(result).toHaveLength(0); // "[invalid" is not a substring of any name
  });

  it("skips documents without string names", () => {
    const mixed = [...docs, { _id: "5", name: 123 }, { _id: "6" }];
    const result = filterByName(mixed, "sword");
    expect(result).toHaveLength(2);
  });

  it("handles empty pattern", () => {
    const result = filterByName(docs, "");
    expect(result).toHaveLength(4); // empty regex matches everything
  });
});

// ── splitFilters ────────────────────────────────────────────────────

describe("splitFilters", () => {
  it("splits top-level and dot-notation filters", () => {
    const { serverQuery, clientFilters } = splitFilters({
      type: "weapon",
      "system.cost": 50,
      name: "Sword",
      "system.details.cr": 5,
    });

    expect(serverQuery).toEqual({ type: "weapon", name: "Sword" });
    expect(clientFilters).toEqual({
      "system.cost": 50,
      "system.details.cr": 5,
    });
  });

  it("handles empty filters", () => {
    const { serverQuery, clientFilters } = splitFilters({});
    expect(serverQuery).toEqual({});
    expect(clientFilters).toEqual({});
  });

  it("handles all top-level filters", () => {
    const { serverQuery, clientFilters } = splitFilters({ type: "a", name: "b" });
    expect(serverQuery).toEqual({ type: "a", name: "b" });
    expect(clientFilters).toEqual({});
  });

  it("handles all dot-notation filters", () => {
    const { serverQuery, clientFilters } = splitFilters({ "a.b": 1, "c.d": 2 });
    expect(serverQuery).toEqual({});
    expect(clientFilters).toEqual({ "a.b": 1, "c.d": 2 });
  });
});

// ── jsonResponse ────────────────────────────────────────────────────

describe("jsonResponse", () => {
  it("wraps data in MCP content format", () => {
    const result = jsonResponse({ status: "ok" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ status: "ok" });
  });

  it("handles arrays", () => {
    const result = jsonResponse([1, 2, 3]);
    expect(JSON.parse(result.content[0].text)).toEqual([1, 2, 3]);
  });

  it("handles null", () => {
    const result = jsonResponse(null);
    expect(result.content[0].text).toBe("null");
  });

  it("pretty-prints with 2-space indentation", () => {
    const result = jsonResponse({ a: 1 });
    expect(result.content[0].text).toContain("\n");
  });
});

// ── errorResponse ───────────────────────────────────────────────────

describe("errorResponse", () => {
  it("creates error response with message", () => {
    const result = errorResponse("Something went wrong");
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe("Something went wrong");
    expect(result.content[0].type).toBe("text");
  });
});

// ── getFirstResult / getResults ─────────────────────────────────────

describe("getFirstResult", () => {
  it("returns first document from response", () => {
    const response = {
      result: [{ _id: "a" }, { _id: "b" }],
    } as unknown as DocumentSocketResponse;
    expect(getFirstResult(response)).toEqual({ _id: "a" });
  });

  it("returns undefined for empty results", () => {
    const response = { result: [] } as unknown as DocumentSocketResponse;
    expect(getFirstResult(response)).toBeUndefined();
  });

  it("returns undefined when result is undefined", () => {
    const response = {} as unknown as DocumentSocketResponse;
    expect(getFirstResult(response)).toBeUndefined();
  });
});

describe("getResults", () => {
  it("returns all documents", () => {
    const response = {
      result: [{ _id: "a" }, { _id: "b" }],
    } as unknown as DocumentSocketResponse;
    expect(getResults(response)).toHaveLength(2);
  });

  it("returns empty array when result is undefined", () => {
    const response = {} as unknown as DocumentSocketResponse;
    expect(getResults(response)).toEqual([]);
  });
});

// ── rollDice ────────────────────────────────────────────────────────

describe("rollDice", () => {
  // Use a deterministic "random" function for testing
  // Returns values cycling through 0.0, 0.25, 0.5, 0.75
  function makeSequence(values: number[]) {
    let i = 0;
    return () => values[i++ % values.length];
  }

  it("rolls basic NdS format", () => {
    // random() = 0.5, d20 = floor(0.5*20)+1 = 11
    expect(rollDice("1d20", () => 0.5)).toBe(11);
  });

  it("rolls multiple dice", () => {
    // 2d6 with random=0.5 each: floor(0.5*6)+1 = 4, twice = 8
    expect(rollDice("2d6", () => 0.5)).toBe(8);
  });

  it("handles d-only format (no count)", () => {
    // d12 = 1d12, random=0.0: floor(0*12)+1 = 1
    expect(rollDice("d12", () => 0.0)).toBe(1);
  });

  it("handles positive modifier", () => {
    // 1d20+5, random=0.5: 11 + 5 = 16
    expect(rollDice("1d20+5", () => 0.5)).toBe(16);
  });

  it("handles negative modifier", () => {
    // 1d20-3, random=0.5: 11 - 3 = 8
    expect(rollDice("1d20-3", () => 0.5)).toBe(8);
  });

  it("handles modifier with spaces", () => {
    expect(rollDice("1d20+ 5", () => 0.5)).toBe(16);
    expect(rollDice("1d20 - 3", () => 0.5)).toBe(8);
  });

  it("parses plain numbers", () => {
    expect(rollDice("10")).toBe(10);
    expect(rollDice("0")).toBe(0);
    expect(rollDice("-5")).toBe(-5);
  });

  it("returns 0 for unparseable formulas", () => {
    expect(rollDice("invalid")).toBe(0);
    expect(rollDice("")).toBe(0);
  });

  it("produces results in valid range with real Math.random", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("1d20");
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(20);
    }
  });

  it("rolls minimum values", () => {
    // random() just below 0 → floor(0*sides)+1 = 1
    expect(rollDice("3d6", () => 0.0)).toBe(3); // 1+1+1
  });

  it("rolls maximum values", () => {
    // random() = 0.999 → floor(0.999*6)+1 = 6
    expect(rollDice("3d6", () => 0.999)).toBe(18); // 6+6+6
  });

  it("uses different random values per die", () => {
    const seq = makeSequence([0.0, 0.999]);
    // 2d6: first=1, second=6 → 7
    expect(rollDice("2d6", seq)).toBe(7);
  });
});
