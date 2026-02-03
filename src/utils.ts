import type { DocumentSocketResponse } from "./types.js";

// ── MCP response helpers ────────────────────────────────────────────

/**
 * Create a successful MCP tool response containing JSON data.
 */
export function jsonResponse(data: unknown): {
  content: { type: "text"; text: string }[];
} {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Create an MCP tool error response.
 */
export function errorResponse(message: string): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/**
 * Get the first document from a modifyDocument "get" response.
 * Returns undefined if no results.
 */
export function getFirstResult(
  response: DocumentSocketResponse,
): Record<string, unknown> | undefined {
  const results = response.result as Record<string, unknown>[] | undefined;
  return results?.[0];
}

/**
 * Get all documents from a modifyDocument "get" response.
 */
export function getResults(
  response: DocumentSocketResponse,
): Record<string, unknown>[] {
  return (response.result || []) as Record<string, unknown>[];
}

// ── Dice rolling ────────────────────────────────────────────────────

/**
 * Parse a dice formula and roll it locally.
 * Supports: "1d20", "2d6", "3d8+5", "d12", plain numbers like "10".
 * Returns the total rolled value (dice + modifiers).
 *
 * Uses an optional random function for testability (defaults to Math.random).
 */
export function rollDice(
  formula: string,
  randomFn: () => number = Math.random,
): number {
  // Match patterns like "2d6+3", "1d20-2", "d12", etc.
  const match = formula.match(/^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i);
  if (!match) {
    // Try as a plain number
    const num = parseInt(formula, 10);
    return isNaN(num) ? 0 : num;
  }

  const count = parseInt(match[1] || "1", 10);
  const sides = parseInt(match[2], 10);
  const modStr = match[3]?.replace(/\s/g, "");
  const modifier = modStr ? parseInt(modStr, 10) : 0;

  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(randomFn() * sides) + 1;
  }

  return total + modifier;
}

// ── Field utilities ─────────────────────────────────────────────────

/**
 * Pick specific fields from a document, supporting dot-notation for nested fields.
 */
export function pickFields(
  doc: Record<string, unknown>,
  fields?: string[],
): Record<string, unknown> {
  if (!fields || fields.length === 0) return doc;
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.includes(".")) {
      // Support dot-notation access for nested fields
      const parts = field.split(".");
      let value: unknown = doc;
      for (const part of parts) {
        if (value && typeof value === "object" && part in value) {
          value = (value as Record<string, unknown>)[part];
        } else {
          value = undefined;
          break;
        }
      }
      result[field] = value;
    } else {
      result[field] = doc[field];
    }
  }
  return result;
}

/**
 * Apply client-side dot-notation field filters to documents.
 * Only filters on keys containing dots (nested fields).
 */
export function applyClientFilters(
  docs: Record<string, unknown>[],
  filters: Record<string, unknown>,
): Record<string, unknown>[] {
  if (Object.keys(filters).length === 0) return docs;
  return docs.filter((d) => {
    for (const [key, expected] of Object.entries(filters)) {
      let value: unknown = d;
      for (const part of key.split(".")) {
        if (value && typeof value === "object" && part in value) {
          value = (value as Record<string, unknown>)[part];
        } else {
          value = undefined;
          break;
        }
      }
      if (value !== expected) return false;
    }
    return true;
  });
}

/**
 * Filter documents by name using regex or substring match.
 */
export function filterByName(
  docs: Record<string, unknown>[],
  namePattern: string,
): Record<string, unknown>[] {
  try {
    const regex = new RegExp(namePattern, "i");
    return docs.filter(
      (d) => typeof d.name === "string" && regex.test(d.name),
    );
  } catch {
    // Fall back to substring match
    const lower = namePattern.toLowerCase();
    return docs.filter(
      (d) =>
        typeof d.name === "string" &&
        d.name.toLowerCase().includes(lower),
    );
  }
}

/**
 * Split filters into server-pushable (top-level) and client-side (dot-notation).
 */
export function splitFilters(
  filters: Record<string, unknown>,
): { serverQuery: Record<string, unknown>; clientFilters: Record<string, unknown> } {
  const serverQuery: Record<string, unknown> = {};
  const clientFilters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (key.includes(".")) {
      clientFilters[key] = value;
    } else {
      serverQuery[key] = value;
    }
  }
  return { serverQuery, clientFilters };
}
