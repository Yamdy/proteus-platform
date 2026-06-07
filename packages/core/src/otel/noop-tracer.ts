import type { ProteusSpan, ProteusTracer, ProteusMetric } from "./types.js";

class NoopSpan implements ProteusSpan {
  readonly name: string;
  readonly spanId: string;
  readonly traceId: string;
  readonly startTime: number;

  constructor(name: string) {
    this.name = name;
    this.spanId = "0".repeat(16);
    this.traceId = "0".repeat(32);
    this.startTime = Date.now();
  }

  setAttribute(_key: string, _value: string | number | boolean): void {}
  setStatus(_code: "ok" | "error", _message?: string): void {}
  end(): void {}
}

export class NoopTracer implements ProteusTracer {
  startSpan(name: string, _parent?: ProteusSpan, _attributes?: Record<string, string | number | boolean>): ProteusSpan {
    return new NoopSpan(name);
  }

  getActiveSpan(): ProteusSpan | undefined {
    return undefined;
  }
}

export class NoopMetric implements ProteusMetric {
  incrementCounter(_name: string, _value?: number, _attributes?: Record<string, string>): void {}
  recordHistogram(_name: string, _value: number, _attributes?: Record<string, string>): void {}
  setGauge(_name: string, _value: number, _attributes?: Record<string, string>): void {}
}
