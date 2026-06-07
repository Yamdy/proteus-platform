import { createHash } from "node:crypto";

/**
 * Compute SHA-256 hash of a string, returned as a 64-character lowercase hex string.
 */
export function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}
