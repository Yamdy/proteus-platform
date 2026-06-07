export type LifecycleState =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "errored"
  | "cancelled";

export type LifecycleEvent =
  | "start"
  | "complete"
  | "suspend"
  | "resume"
  | "error"
  | "cancel";

const TRANSITIONS: Record<LifecycleState, Partial<Record<LifecycleEvent, LifecycleState>>> = {
  pending:   { start: "running" },
  running:   { complete: "completed", suspend: "paused", error: "errored", cancel: "cancelled" },
  paused:    { resume: "running" },
  completed: {},
  errored:   { start: "running" },
  cancelled: {},
};

export class LifecycleStateMachine {
  private _state: LifecycleState;

  constructor(initial: LifecycleState = "pending") {
    this._state = initial;
  }

  get state(): LifecycleState {
    return this._state;
  }

  canTransition(event: LifecycleEvent): boolean {
    return event in (TRANSITIONS[this._state] ?? {});
  }

  transition(event: LifecycleEvent): LifecycleState {
    const next = TRANSITIONS[this._state]?.[event];
    if (!next) {
      throw new Error(
        `Invalid transition: ${this._state} → ${event} (not allowed)`
      );
    }
    this._state = next;
    return this._state;
  }

  toJSON(): { state: LifecycleState } {
    return { state: this._state };
  }

  static fromJSON(data: { state: LifecycleState }): LifecycleStateMachine {
    return new LifecycleStateMachine(data.state);
  }
}
