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
