// --- StructuredWorkingMemory ---
//
// Per-thread key-value working memory with template rendering.
// Each thread (identified by threadId) holds a flat Record<string, string>
// that can be rendered into a prompt fragment via {{key}} placeholders.

export interface StructuredWorkingMemoryOptions {
  /** Template string with {{key}} placeholders. */
  template: string;
  /** Optional token budget; getFormatted() throws if the rendered string exceeds this. */
  maxTokens?: number;
}

export class StructuredWorkingMemory {
  private readonly template: string;
  private readonly maxTokens?: number;
  private readonly store = new Map<string, Record<string, string>>();

  constructor(opts: StructuredWorkingMemoryOptions) {
    this.template = opts.template;
    this.maxTokens = opts.maxTokens;
  }

  /**
   * Returns a defensive copy of the current state for the given thread.
   * Returns an empty object if the thread has no data.
   */
  get(threadId: string): Record<string, string> {
    const existing = this.store.get(threadId);
    return existing ? { ...existing } : {};
  }

  /**
   * Replaces the entire state for the given thread.
   */
  update(threadId: string, data: Record<string, string>): void {
    this.store.set(threadId, { ...data });
  }

  /**
   * Shallow-merges partial data into the existing state for the given thread.
   * Creates state if the thread has no prior data.
   */
  merge(threadId: string, partial: Record<string, string>): void {
    const existing = this.store.get(threadId) ?? {};
    this.store.set(threadId, { ...existing, ...partial });
  }

  /**
   * Renders the template with the current state for the given thread.
   * Missing keys are replaced with empty strings.
   * Throws if the rendered string exceeds maxTokens (character-count proxy).
   */
  getFormatted(threadId: string): string {
    const state = this.store.get(threadId) ?? {};
    const rendered = this.template.replace(
      /\{\{(\w+)\}\}/g,
      (_match, key: string) => state[key] ?? "",
    );

    if (this.maxTokens !== undefined && rendered.length > this.maxTokens) {
      throw new Error(
        `Formatted output (${rendered.length} chars) exceeds maxTokens (${this.maxTokens})`,
      );
    }

    return rendered;
  }
}
