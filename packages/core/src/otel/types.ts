/**
 * ProteusSpan — core's own span interface.
 * OTel SDK types never appear in public exports.
 */
export interface ProteusSpan {
  readonly name: string;
  readonly spanId: string;
  readonly traceId: string;
  readonly startTime: number;
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(code: "ok" | "error", message?: string): void;
  end(): void;
}

/**
 * ProteusTracer — core's own tracer interface.
 */
export interface ProteusTracer {
  startSpan(
    name: string,
    parent?: ProteusSpan,
    attributes?: Record<string, string | number | boolean>,
  ): ProteusSpan;
  getActiveSpan(): ProteusSpan | undefined;
}

/**
 * ProteusMetric — core's own metric interface.
 */
export interface ProteusMetric {
  incrementCounter(name: string, value?: number, attributes?: Record<string, string>): void;
  recordHistogram(name: string, value: number, attributes?: Record<string, string>): void;
  setGauge(name: string, value: number, attributes?: Record<string, string>): void;
}
