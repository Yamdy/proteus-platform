import type { HandlerContext } from "./context.js";

// --- PromptFragmentEntry ---

export interface PromptFragmentEntry {
  name: string;
  role: "system" | "user" | "assistant";
  content: string;
  priority?: number; // default 100, lower = earlier
  tags?: string[]; // e.g. ["persona", "instructions"]
  sessionIds?: string[]; // if set, only inject into these sessions
  condition?: (ctx: HandlerContext) => boolean; // runtime filter
}

// --- SerializedFragments ---

export interface SerializedFragment {
  name: string;
  role: string;
  content: string;
  priority?: number;
  tags?: string[];
  sessionIds?: string[];
  // condition functions are not serializable - they must be re-registered from source
}

export interface SerializedFragments {
  fragments: SerializedFragment[];
}

// --- PromptFragmentRegistry ---

export class PromptFragmentRegistry {
  private fragments: Map<string, PromptFragmentEntry> = new Map();

  register(fragment: PromptFragmentEntry): void {
    this.fragments.set(fragment.name, fragment);
  }

  unregister(name: string): void {
    this.fragments.delete(name);
  }

  replace(name: string, fragment: PromptFragmentEntry): void {
    if (!this.fragments.has(name)) {
      throw new Error(`Fragment "${name}" not found`);
    }
    this.fragments.set(name, fragment);
  }

  get(name: string): PromptFragmentEntry | undefined {
    return this.fragments.get(name);
  }

  getByRole(role: string): PromptFragmentEntry[] {
    return Array.from(this.fragments.values())
      .filter((f) => f.role === role)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  getAll(): PromptFragmentEntry[] {
    return Array.from(this.fragments.values()).sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100),
    );
  }

  getByTag(tag: string): PromptFragmentEntry[] {
    return Array.from(this.fragments.values())
      .filter((f) => f.tags?.includes(tag))
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  serialize(): SerializedFragments {
    return {
      fragments: Array.from(this.fragments.values()).map((f) => ({
        name: f.name,
        role: f.role,
        content: f.content,
        priority: f.priority,
        tags: f.tags,
        sessionIds: f.sessionIds,
      })),
    };
  }

  static deserialize(data: SerializedFragments): PromptFragmentRegistry {
    const registry = new PromptFragmentRegistry();
    for (const f of data.fragments) {
      registry.register({
        name: f.name,
        role: f.role as "system" | "user" | "assistant",
        content: f.content,
        priority: f.priority,
        tags: f.tags,
        sessionIds: f.sessionIds,
      });
    }
    return registry;
  }
}
