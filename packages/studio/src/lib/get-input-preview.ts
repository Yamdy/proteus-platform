const MAX_PREVIEW_LENGTH = 80;

function truncate(text: string, max = MAX_PREVIEW_LENGTH): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function extractFromMessages(arr: unknown[]): string | undefined {
  for (const item of arr) {
    if (
      item != null &&
      typeof item === "object" &&
      "role" in item &&
      (item as Record<string, unknown>).role === "user" &&
      "content" in item
    ) {
      const content = (item as Record<string, unknown>).content;
      if (typeof content === "string") return content;
      if (content != null) return JSON.stringify(content);
    }
  }
  // No user message found; fall back to first item's content
  if (arr.length > 0) {
    const first = arr[0];
    if (first != null && typeof first === "object" && "content" in first) {
      const content = (first as Record<string, unknown>).content;
      if (typeof content === "string") return content;
      if (content != null) return JSON.stringify(content);
    }
  }
  return undefined;
}

/**
 * Extract a short preview string from a trace's input field.
 *
 * - string  -> truncate to 80 chars
 * - array   -> first user message content, truncated
 * - object with `content` -> that value, truncated
 * - fallback -> JSON.stringify, truncated
 */
export function getInputPreview(input: unknown): string {
  if (typeof input === "string") return truncate(input);
  if (Array.isArray(input)) {
    const extracted = extractFromMessages(input);
    return truncate(extracted ?? JSON.stringify(input));
  }
  if (input != null && typeof input === "object" && "content" in input) {
    const content = (input as Record<string, unknown>).content;
    if (typeof content === "string") return truncate(content);
    if (content != null) return truncate(JSON.stringify(content));
  }
  if (input === null) return "null";
  if (input === undefined) return "undefined";
  return truncate(JSON.stringify(input));
}
