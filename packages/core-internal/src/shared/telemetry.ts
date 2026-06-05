import { writeSync } from "node:fs";

export type TelemetryAttributeValue = string | number | boolean;

export interface TelemetryAttributes {
  [key: string]: TelemetryAttributeValue | undefined;
}

export interface TelemetrySpanHandle {
  id: number;
}

interface MutableTelemetrySpan {
  id: number;
  name: string;
  startMs: number;
  endMs?: number;
  attributes?: TelemetryAttributes;
  endedAtExit?: boolean;
}

export interface TelemetryCollectorOptions {
  env?: Record<string, string | undefined>;
  now?: () => number;
  write?: (text: string) => void;
}

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function isTelemetryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.GITHITS_TELEMETRY?.trim().toLowerCase();
  if (!raw) return false;
  return ENABLED_VALUES.has(raw);
}

export class TelemetryCollector {
  private readonly enabled: boolean;
  private readonly now: () => number;
  private readonly write: (text: string) => void;
  private readonly sessionStartMs: number;
  private readonly spans: MutableTelemetrySpan[] = [];
  private readonly activeSpans = new Map<number, MutableTelemetrySpan>();
  private nextId = 1;
  private flushed = false;

  constructor(options: TelemetryCollectorOptions = {}) {
    this.enabled = isTelemetryEnabled(options.env);
    this.now = options.now ?? (() => globalThis.performance.now());
    this.write =
      options.write ?? ((text: string) => writeSync(process.stderr.fd, text));
    this.sessionStartMs = this.now();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  startSpan(
    name: string,
    attributes?: TelemetryAttributes,
  ): TelemetrySpanHandle | undefined {
    if (!this.enabled) return undefined;

    const span: MutableTelemetrySpan = {
      id: this.nextId++,
      name,
      startMs: this.now(),
      attributes: sanitiseAttributes(attributes),
    };

    this.spans.push(span);
    this.activeSpans.set(span.id, span);
    return { id: span.id };
  }

  endSpan(
    handle: TelemetrySpanHandle | undefined,
    attributes?: TelemetryAttributes,
  ): void {
    if (!this.enabled || !handle) return;

    const span = this.activeSpans.get(handle.id);
    if (!span || span.endMs !== undefined) return;

    span.endMs = this.now();
    span.attributes = mergeAttributes(span.attributes, attributes);
    this.activeSpans.delete(handle.id);
  }

  flush(exitCode: number = 0): void {
    if (!this.enabled || this.flushed) return;

    const nowMs = this.now();
    for (const span of this.activeSpans.values()) {
      if (span.endMs !== undefined) continue;
      span.endMs = nowMs;
      span.endedAtExit = true;
    }
    this.activeSpans.clear();

    this.write(
      formatTelemetryReport(this.spans, this.sessionStartMs, nowMs, exitCode),
    );
    this.flushed = true;
  }
}

export async function withTelemetrySpan<T>(
  name: string,
  operation: () => Promise<T>,
  attributes?: TelemetryAttributes,
): Promise<T> {
  const handle = telemetryCollector.startSpan(name, attributes);
  try {
    const result = await operation();
    telemetryCollector.endSpan(handle);
    return result;
  } catch (error) {
    telemetryCollector.endSpan(handle, { error: true });
    throw error;
  }
}

export function withTelemetrySpanSync<T>(
  name: string,
  operation: () => T,
  attributes?: TelemetryAttributes,
): T {
  const handle = telemetryCollector.startSpan(name, attributes);
  try {
    const result = operation();
    telemetryCollector.endSpan(handle);
    return result;
  } catch (error) {
    telemetryCollector.endSpan(handle, { error: true });
    throw error;
  }
}

export function startTelemetrySpan(
  name: string,
  attributes?: TelemetryAttributes,
): TelemetrySpanHandle | undefined {
  return telemetryCollector.startSpan(name, attributes);
}

export function endTelemetrySpan(
  handle: TelemetrySpanHandle | undefined,
  attributes?: TelemetryAttributes,
): void {
  telemetryCollector.endSpan(handle, attributes);
}

export function flushTelemetry(exitCode: number = 0): void {
  telemetryCollector.flush(exitCode);
}

export function resetTelemetryCollectorForTests(
  options: TelemetryCollectorOptions = {},
): void {
  telemetryCollector = new TelemetryCollector(options);
}

let telemetryCollector = new TelemetryCollector();

function sanitiseAttributes(
  attributes?: TelemetryAttributes,
): TelemetryAttributes | undefined {
  if (!attributes) return undefined;

  const entries = Object.entries(attributes).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function mergeAttributes(
  initial?: TelemetryAttributes,
  extra?: TelemetryAttributes,
): TelemetryAttributes | undefined {
  if (!initial && !extra) return undefined;
  return sanitiseAttributes({
    ...(initial ?? {}),
    ...(extra ?? {}),
  });
}

function formatTelemetryReport(
  spans: MutableTelemetrySpan[],
  sessionStartMs: number,
  sessionEndMs: number,
  exitCode: number,
): string {
  const lines = [
    "[githits telemetry]",
    `exit: ${exitCode}`,
    `total: ${formatMs(sessionEndMs - sessionStartMs)}`,
  ];

  const orderedSpans = [...spans].sort((left, right) => {
    if (left.startMs !== right.startMs) {
      return left.startMs - right.startMs;
    }
    return left.id - right.id;
  });

  for (const span of orderedSpans) {
    const endMs = span.endMs ?? sessionEndMs;
    const details = [`start +${formatMs(span.startMs - sessionStartMs)}`];

    if (span.endedAtExit) {
      details.push("ended-at-exit");
    }

    const attrs = formatAttributes(span.attributes);
    if (attrs) {
      details.push(attrs);
    }

    lines.push(
      `- ${span.name}: ${formatMs(endMs - span.startMs)} (${details.join(", ")})`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatAttributes(attributes?: TelemetryAttributes): string {
  if (!attributes) return "";
  return Object.entries(attributes)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}
