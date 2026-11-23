import { afterEach, describe, expect, it } from "bun:test";
import { RelayReceiver, type RelaySocket } from "./relay-receiver.js";

const RELAY_ID = "00000000-0000-4000-8000-000000000000";

class ControlledSocket implements RelaySocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  open(): void {
    this.onopen?.();
  }

  error(): void {
    this.onerror?.();
  }

  drop(): void {
    this.onclose?.();
  }

  close(): void {
    this.closed = true;
  }
}

interface ScheduledTimer {
  callback: () => void;
  due: number;
}

class ControlledClock {
  now = 1_000_000;
  private nextId = 1;
  private readonly timers = new Map<number, ScheduledTimer>();
  private readonly originalSetTimeout = globalThis.setTimeout;
  private readonly originalClearTimeout = globalThis.clearTimeout;

  install(): void {
    globalThis.setTimeout = ((callback: () => void, delay = 0) => {
      const id = this.nextId++;
      this.timers.set(id, { callback, due: this.now + delay });
      return { id, unref: () => {} } as unknown as ReturnType<
        typeof setTimeout
      >;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((handle: { id: number }) => {
      this.timers.delete(handle.id);
    }) as unknown as typeof clearTimeout;
  }

  restore(): void {
    globalThis.setTimeout = this.originalSetTimeout;
    globalThis.clearTimeout = this.originalClearTimeout;
  }

  async advance(ms: number): Promise<void> {
    // Flush the current turn before firing timers, as the event loop does.
    await flush();
    const target = this.now + ms;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      this.timers.delete(next[0]);
      this.now = next[1].due;
      next[1].callback();
      await flush();
    }
    this.now = target;
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

interface LifecycleHarness {
  clock: ControlledClock;
  receiver: RelayReceiver;
  sockets: ControlledSocket[];
  setupCalls: number[];
  responses: (Response | Promise<Response>)[];
}

function access(clock: ControlledClock, seconds: number): Response {
  return Response.json({
    relay_id: RELAY_ID,
    connection_url: "wss://relay.test/client",
    expires_at: (clock.now + seconds * 1_000) / 1_000,
  });
}

function harness(): LifecycleHarness {
  const clock = new ControlledClock();
  clock.install();
  const sockets: ControlledSocket[] = [];
  const setupCalls: number[] = [];
  const responses: LifecycleHarness["responses"] = [access(clock, 30)];
  let id = 0;
  const receiver = new RelayReceiver({
    apiUrl: "https://api.githits.test",
    auth: { kind: "caller", getToken: async () => "token" },
    fetchFn: (async () => {
      setupCalls.push(clock.now);
      const response = responses.shift();
      if (!response) throw new Error("unexpected relay setup");
      return response;
    }) as unknown as typeof fetch,
    createSocket: () => {
      const socket = new ControlledSocket();
      sockets.push(socket);
      return socket;
    },
    now: () => clock.now,
    createId: () => `00000000-0000-4000-8000-00000000000${id++}`,
    minRenewDelayMs: 10,
    reconnectBaseMs: 5,
  });
  return { clock, receiver, sockets, setupCalls, responses };
}

let active: LifecycleHarness | undefined;
afterEach(() => {
  active?.receiver.close();
  active?.clock.restore();
  active = undefined;
});

function start(): LifecycleHarness {
  active = harness();
  return active;
}

describe("RelayReceiver lifecycle", () => {
  it("times out a stalled WebSocket handshake and retries", async () => {
    const { clock, receiver, sockets, responses, setupCalls } = start();

    await receiver.begin(() => {});
    await flush();

    expect(sockets).toHaveLength(1);

    responses.push(access(clock, 900));

    await clock.advance(4_999);
    expect(sockets[0]?.closed).toBe(false);
    expect(setupCalls).toHaveLength(1);

    await clock.advance(1);
    expect(sockets[0]?.closed).toBe(true);

    await clock.advance(5);
    expect(setupCalls).toHaveLength(2);
    expect(sockets).toHaveLength(2);
  });

  it("does not close an established socket after the handshake deadline", async () => {
    const { clock, receiver, sockets } = start();

    await receiver.begin(() => {});
    await flush();

    sockets[0]?.open();
    await flush();

    await clock.advance(5_000);

    expect(sockets[0]?.closed).toBe(false);
  });

  it("cancels a pending reconnect after a socket opens", async () => {
    const { clock, receiver, sockets, responses, setupCalls } = start();

    await receiver.begin(() => {});
    await flush();

    responses.push(access(clock, 900));

    sockets[0]?.error();
    await flush();

    // A new connection succeeds before the scheduled retry fires.
    // Reconnection must not mint another relay unnecessarily.
    await clock.advance(5);

    expect(sockets).toHaveLength(2);

    sockets[1]?.open();
    await flush();

    await clock.advance(100);

    expect(setupCalls).toHaveLength(2);
    expect(sockets).toHaveLength(2);
  });

  it("closes a socket still waiting to open during shutdown", async () => {
    const { receiver, sockets } = start();
    await receiver.begin(() => {});
    await flush();
    expect(sockets).toHaveLength(1);
    receiver.close();
    expect(sockets[0]?.closed).toBe(true);
  });

  it("recovers when an established socket errors without a close event", async () => {
    const { clock, receiver, sockets, responses, setupCalls } = start();
    await receiver.begin(() => {});
    await flush();
    sockets[0]?.open();
    await flush();
    responses.push(access(clock, 900));
    sockets[0]?.error();
    await clock.advance(5);
    expect(setupCalls).toHaveLength(2);
  });

  it("retries when a connecting socket errors without a close event", async () => {
    const { clock, receiver, sockets, responses, setupCalls } = start();
    await receiver.begin(() => {});
    await flush();
    responses.push(access(clock, 900));
    sockets[0]?.error();
    await clock.advance(5);
    expect(setupCalls).toHaveLength(2);
  });

  it("renews after an initial socket opens beyond its first renewal deadline", async () => {
    const { clock, receiver, sockets, responses, setupCalls } = start();
    await receiver.begin(() => {});
    await flush();
    expect(sockets).toHaveLength(1);
    await clock.advance(10);
    responses.push(access(clock, 900));
    sockets[0]?.open();
    await flush();
    await clock.advance(10);
    expect(setupCalls).toHaveLength(2);
  });

  it("reuses the working socket after a replacement fails", async () => {
    const { clock, receiver, sockets, responses, setupCalls } = start();

    await receiver.begin(() => {});
    await flush();

    sockets[0]?.open();
    await flush();

    responses.push(access(clock, 900));

    // Trigger renewal and fail the replacement socket.
    await clock.advance(10);
    expect(sockets).toHaveLength(2);

    sockets[1]?.error();
    await flush();

    expect(sockets[0]?.closed).toBe(false);

    const callsBefore = setupCalls.length;

    // Another operation should reuse the existing working socket.
    const operation = await receiver.begin(() => {});
    expect(operation).toBeDefined();

    await flush();

    expect(setupCalls).toHaveLength(callsBefore);
    expect(sockets[0]?.closed).toBe(false);
  });

  it("reuses an in-flight renewal when the old socket drops", async () => {
    const { clock, receiver, sockets, responses, setupCalls } = start();
    await receiver.begin(() => {});
    await flush();
    sockets[0]?.open();
    await flush();

    responses.push(access(clock, 900));
    await clock.advance(10);
    expect(sockets).toHaveLength(2);

    sockets[0]?.drop();
    await clock.advance(5);
    expect(setupCalls).toHaveLength(2);

    sockets[1]?.open();
    await flush();
    expect(setupCalls).toHaveLength(2);
  });

  it("checks the active socket's own expiry after a failed renewal", async () => {
    const { clock, receiver, sockets, responses, setupCalls } = start();
    responses[0] = access(clock, 1);
    await receiver.begin(() => {});
    await flush();
    sockets[0]?.open();
    await flush();

    responses.push(access(clock, 900));
    await clock.advance(999);
    expect(sockets).toHaveLength(2);
    sockets[1]?.error();
    await clock.advance(1);
    expect(setupCalls).toHaveLength(2);

    // The old access has now expired and the reconnect delay has not elapsed.
    responses.push(access(clock, 900));
    await receiver.begin(() => {});
    await flush();
    expect(setupCalls).toHaveLength(3);
  });

  it.each([0, 5])(
    "honors Retry-After when the old socket has been dropped for %d ms",
    async (elapsedMs) => {
      const { clock, receiver, sockets, responses, setupCalls } = start();
      await receiver.begin(() => {});
      await flush();
      sockets[0]?.open();
      await flush();

      const renewal = Promise.withResolvers<Response>();
      responses.push(renewal.promise);
      await clock.advance(10);
      expect(setupCalls).toHaveLength(2);

      sockets[0]?.drop();
      await clock.advance(elapsedMs);
      expect(setupCalls).toHaveLength(2);

      responses.push(access(clock, 900));
      renewal.resolve(
        new Response(null, { status: 429, headers: { "Retry-After": "7" } }),
      );
      await clock.advance(6_999);
      expect(setupCalls).toHaveLength(2);

      await clock.advance(1);
      expect(setupCalls).toHaveLength(3);
    },
  );

  it("retries a failed renewal while an operation remains active", async () => {
    const { clock, receiver, sockets, responses, setupCalls } = start();
    await receiver.begin(() => {});
    await flush();
    sockets[0]?.open();
    await flush();
    responses.push(new Response(null, { status: 503 }));
    await clock.advance(10);
    expect(setupCalls).toHaveLength(2);
    responses.push(access(clock, 900));
    await clock.advance(5 * 60_000);
    expect(setupCalls).toHaveLength(3);
  });

  it.each(["fails", "succeeds"] as const)(
    "does not open a socket or retry when setup %s after shutdown",
    async (outcome) => {
      const { clock, receiver, sockets, responses, setupCalls } = start();
      const setup = Promise.withResolvers<Response>();
      responses.splice(0, 1, setup.promise);

      await receiver.begin(() => {});
      await flush();
      expect(setupCalls).toHaveLength(1);

      receiver.close();
      if (outcome === "fails") setup.reject(new Error("network failure"));
      else setup.resolve(access(clock, 900));

      await clock.advance(5 * 60_000);
      expect(setupCalls).toHaveLength(1);
      expect(sockets).toHaveLength(0);
    },
  );

  it("respects Retry-After before retrying an active operation", async () => {
    const { clock, receiver, responses, setupCalls } = start();
    responses.splice(
      0,
      1,
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "7" },
      }),
    );

    await receiver.begin(() => {});
    await flush();
    expect(setupCalls).toHaveLength(1);

    responses.push(access(clock, 900));

    await clock.advance(6_999);
    expect(setupCalls).toHaveLength(1);

    await clock.advance(1);
    expect(setupCalls).toHaveLength(2);
  });

  it("honors Retry-After when the old socket's renewal is still scheduled", async () => {
    const { clock, receiver, sockets, responses, setupCalls } = start();
    await receiver.begin(() => {});
    await flush();
    sockets[0]?.open();
    await flush();

    responses.push(
      new Response(null, { status: 429, headers: { "Retry-After": "7" } }),
    );
    sockets[0]?.drop();
    await clock.advance(5);
    expect(setupCalls).toHaveLength(2);

    responses.push(access(clock, 900));
    await clock.advance(6_999);
    expect(setupCalls).toHaveLength(2);

    await clock.advance(1);
    expect(setupCalls).toHaveLength(3);
  });

  it("retries initial setup after backoff while an operation remains active", async () => {
    const { clock, receiver, responses, setupCalls } = start();
    responses.splice(0, 1, new Response(null, { status: 503 }));
    await receiver.begin(() => {});
    await flush();
    expect(setupCalls).toHaveLength(1);
    responses.push(access(clock, 900));
    await clock.advance(5 * 60_000);
    expect(setupCalls).toHaveLength(2);
  });
});
