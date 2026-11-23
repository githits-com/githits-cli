import type { ProgressRequest } from "@githits/core-internal";
import WebSocket from "ws";

/** One MCP progress update derived from a backend progress event. */
export interface McpProgressUpdate {
  /** Strictly increasing per operation; suitable for MCP `progress`. */
  progress: number;
  /** Fixed, server-allowlisted status text. */
  message: string;
  /** Coarse backend stage, such as `searching` or `reading`, when provided. */
  stage?: string;
}

/** One correlated backend call; `end()` stops delivery before the result returns. */
export interface McpProgressOperation extends ProgressRequest {
  end(): void;
}

/**
 * Optional, credential-free progress source for long-running tools.
 *
 * `begin` returns `undefined` whenever progress is unavailable; tools then run
 * exactly as without a hook. The HTTP result is always authoritative.
 */
export interface McpProgressHook {
  begin(
    notify: (update: McpProgressUpdate) => void,
  ): Promise<McpProgressOperation | undefined>;
}

/**
 * How the receiver authenticates relay setup.
 *
 * - `caller`: the caller's own GitHits token (local MCP); progress reaches only
 *   that caller's receiver.
 * - `service`: a trusted service credential for a server that multiplexes
 *   many callers over one socket. The credential is supplied at runtime and
 *   never ships in this package.
 */
export type RelayAuth =
  | { kind: "caller"; getToken: () => Promise<string | undefined> }
  | { kind: "service"; serviceId: string; key: string };

/** The subset of a WebSocket the receiver uses; `ws` and WHATWG sockets fit. */
export interface RelaySocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

export interface RelayReceiverOptions {
  apiUrl: string;
  auth: RelayAuth;
  fetchFn?: typeof fetch;
  createSocket?: (url: string) => RelaySocket;
  /** Extra headers for relay setup requests, such as client attribution. */
  clientHeaders?: () => Record<string, string>;
  /** @deprecated Ignored: calls never wait for the relay socket. */
  connectWaitMs?: number;
  /** @deprecated Ignored: calls never wait for the relay socket. */
  firstConnectWaitMs?: number;
  /** Close an unused socket after this long. */
  idleCloseMs?: number;
  /** First reconnect delay; doubles per attempt up to 30 s. */
  reconnectBaseMs?: number;
  /** Earliest renewal after a mint, even for short-lived receive URLs. */
  minRenewDelayMs?: number;
  now?: () => number;
  createId?: () => string;
}

interface RelayAccess {
  url: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

interface Route {
  notify: (update: McpProgressUpdate) => void;
  lastSequence: number;
}

class RelayUnavailableError extends Error {
  constructor(readonly backoffMs: number) {
    super("Progress relay unavailable");
  }
}

const SETUP_TIMEOUT_MS = 5_000;
const SOCKET_OPEN_TIMEOUT_MS = 5_000;
const RENEW_BEFORE_EXPIRY_MS = 60_000;
const MIN_RENEW_DELAY_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const NETWORK_BACKOFF_MS = 30_000;
const UNAVAILABLE_BACKOFF_MS = 5 * 60_000;
const MAX_MESSAGE_LENGTH = 200;

/**
 * Receives backend operation progress over one shared WebSocket and routes it
 * to the MCP call that supplied each operation ID.
 *
 * Calls never wait for the relay. The relay ID is chosen locally, so a call's
 * progress headers are known immediately; minting the receive URL and opening
 * the socket run in the background, and updates are delivered once the socket
 * joins. Updates published before that are missed, which only affects the
 * first call of a process. Every failure degrades to "no progress": relay setup
 * errors back off, socket drops reconnect in the background, and late or
 * unknown events are dropped.
 */
export class RelayReceiver implements McpProgressHook {
  private readonly fetchFn: typeof fetch;
  private readonly createSocket: (url: string) => RelaySocket;
  private readonly relayId: string;
  private readonly idleCloseMs: number;
  private readonly reconnectBaseMs: number;
  private readonly minRenewDelayMs: number;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly routes = new Map<string, Route>();
  private activeConnection:
    | { socket: RelaySocket; expiresAt: number }
    | undefined;
  private openingSocket: RelaySocket | undefined;
  private finishOpening: (() => void) | undefined;
  private connecting: Promise<void> | undefined;
  private unavailableUntil = 0;
  private reconnectAttempts = 0;
  private renewTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly options: RelayReceiverOptions) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.createSocket =
      options.createSocket ??
      ((url) => new WebSocket(url) as unknown as RelaySocket);
    this.idleCloseMs = options.idleCloseMs ?? 5 * 60_000;
    this.reconnectBaseMs = options.reconnectBaseMs ?? RECONNECT_BASE_MS;
    this.minRenewDelayMs = options.minRenewDelayMs ?? MIN_RENEW_DELAY_MS;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => globalThis.crypto.randomUUID());
    // Relay groups are namespaced per caller or service by the backend, so the
    // client may choose the ID and renew it into a receive URL at any time.
    this.relayId = this.createId().toLowerCase();
  }

  async begin(
    notify: (update: McpProgressUpdate) => void,
  ): Promise<McpProgressOperation | undefined> {
    if (this.closed || this.now() < this.unavailableUntil) return undefined;
    this.clearTimer("idleTimer");
    // Connect in the background; never delay the call for progress.
    void this.ensureConnected();
    const operationId = this.createId().toLowerCase();
    this.routes.set(operationId, { notify, lastSequence: 0 });
    let ended = false;
    return {
      headers: {
        "X-GitHits-Progress-Id": operationId,
        "X-GitHits-Relay-Id": this.relayId,
        ...this.serviceHeaders(),
      },
      rejected: () => {
        // Rejections happen before execution; stop offering progress for a while.
        this.unavailableUntil = this.now() + UNAVAILABLE_BACKOFF_MS;
      },
      end: () => {
        if (ended) return;
        ended = true;
        this.routes.delete(operationId);
        this.scheduleIdleClose();
      },
    };
  }

  /**
   * Starts minting and connecting in the background before the first call,
   * for hosts that know a progress call is about to start. Never waits.
   */
  warm(): void {
    if (this.closed || this.now() < this.unavailableUntil) return;
    void this.ensureConnected().then(() => this.scheduleIdleClose());
  }

  /** Stops all timers and closes the socket; later calls get no progress. */
  close(): void {
    this.closed = true;
    this.routes.clear();
    this.clearTimer("renewTimer");
    this.clearTimer("reconnectTimer");
    this.clearTimer("idleTimer");
    this.closeSocket();
  }

  private ensureConnected(): Promise<void> {
    if (this.activeConnection && this.now() < this.activeConnection.expiresAt) {
      return Promise.resolve();
    }
    return this.ensureFresh();
  }

  private async connect(): Promise<void> {
    let relay: RelayAccess;
    try {
      relay = await this.setup();
    } catch (error) {
      const backoffMs =
        error instanceof RelayUnavailableError
          ? error.backoffMs
          : NETWORK_BACKOFF_MS;
      this.unavailableUntil = this.now() + backoffMs;
      // Setup's backoff supersedes timers scheduled by the old socket.
      this.clearTimer("renewTimer");
      this.clearTimer("reconnectTimer");
      if (this.routes.size > 0) this.scheduleReconnect(backoffMs);
      return;
    }
    if (this.closed) return;
    const opened = await this.openSocket(relay);
    if (opened && !this.closed) this.scheduleRenewal(relay);
  }

  /** Resolves true when the socket opens and becomes the active socket. */
  private openSocket(relay: RelayAccess): Promise<boolean> {
    return new Promise((resolve) => {
      let socket: RelaySocket;
      try {
        socket = this.createSocket(relay.url);
      } catch {
        this.socketFailed();
        resolve(false);
        return;
      }
      this.openingSocket = socket;
      this.finishOpening = () => {
        clearTimeout(openTimer);
        resolve(false);
      };
      let opened = false;
      const openTimer = setTimeout(() => {
        failed();
      }, SOCKET_OPEN_TIMEOUT_MS);
      unrefTimer(openTimer);
      // Deliver from the replacement immediately; duplicates are dropped by sequence.
      socket.onmessage = (event) => this.deliver(event.data);
      socket.onopen = () => {
        clearTimeout(openTimer);
        this.openingSocket = undefined;
        this.finishOpening = undefined;
        opened = true;
        this.clearTimer("reconnectTimer");
        this.reconnectAttempts = 0;
        // Swap only after the new socket opens so renewal never leaves a gap
        // and a failed replacement never orphans the working socket.
        const previous = this.activeConnection;
        this.activeConnection = { socket, expiresAt: relay.expiresAt };
        if (previous) this.detach(previous.socket);
        resolve(true);
      };
      const failed = () => {
        clearTimeout(openTimer);
        if (!opened) {
          this.openingSocket = undefined;
          this.finishOpening = undefined;
          this.detach(socket);
          if (!this.activeConnection) this.socketFailed();
          else if (this.routes.size > 0) this.scheduleReconnect();
          resolve(false);
          return;
        }
        if (this.activeConnection?.socket !== socket) return;
        this.activeConnection = undefined;
        this.detach(socket);
        if (!this.closed && this.routes.size > 0) this.scheduleReconnect();
      };
      socket.onclose = failed;
      socket.onerror = failed;
    });
  }

  /** A socket that cannot open (e.g. a proxy blocking WebSockets) backs off. */
  private socketFailed(): void {
    const delay = Math.min(
      RECONNECT_MAX_MS,
      this.reconnectBaseMs * 2 ** this.reconnectAttempts,
    );
    this.unavailableUntil = Math.max(this.unavailableUntil, this.now() + delay);
    if (this.routes.size > 0) this.scheduleReconnect();
    else this.reconnectAttempts += 1;
  }

  private deliver(data: unknown): void {
    const event = parseEvent(data);
    if (!event) return;
    const route = this.routes.get(event.operationId);
    // Overlapping sockets during renewal can duplicate events; MCP progress
    // must strictly increase, so drop anything not newer than the last one.
    if (!route || event.sequence <= route.lastSequence) return;
    route.lastSequence = event.sequence;
    try {
      route.notify({
        progress: event.sequence,
        message: event.message,
        ...(event.stage ? { stage: event.stage } : {}),
      });
    } catch {
      // A failed notification must never affect the tool call.
    }
  }

  /** Mints a receive URL for this receiver's locally chosen relay ID. */
  private async setup(): Promise<RelayAccess> {
    const headers: Record<string, string> = {
      ...this.options.clientHeaders?.(),
      ...(await this.authHeaders()),
      "Content-Type": "application/json",
    };
    const response = await this.fetchFn(
      `${this.options.apiUrl.replace(/\/+$/, "")}/progress/relays/renew`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ relay_id: this.relayId }),
        signal: AbortSignal.timeout(SETUP_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new RelayUnavailableError(backoffFor(response));
    }
    const access = parseRelayAccess(await response.json(), this.relayId);
    if (!access) throw new RelayUnavailableError(UNAVAILABLE_BACKOFF_MS);
    return access;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const { auth } = this.options;
    if (auth.kind === "service") return this.serviceHeaders();
    const token = await auth.getToken();
    if (!token) throw new RelayUnavailableError(UNAVAILABLE_BACKOFF_MS);
    return { Authorization: `Bearer ${token}` };
  }

  private serviceHeaders(): Record<string, string> {
    const { auth } = this.options;
    return auth.kind === "service"
      ? {
          "X-GitHits-Relay-Service": auth.serviceId,
          "X-GitHits-Relay-Key": auth.key,
        }
      : {};
  }

  private scheduleRenewal(relay: RelayAccess): void {
    this.clearTimer("renewTimer");
    const delay = Math.max(
      this.minRenewDelayMs,
      relay.expiresAt - RENEW_BEFORE_EXPIRY_MS - this.now(),
    );
    this.renewTimer = setTimeout(() => {
      this.renewTimer = undefined;
      if (this.routes.size === 0) {
        // Nothing to deliver: let the next call reconnect on demand.
        this.closeSocket();
        return;
      }
      void this.ensureFresh();
    }, delay);
    unrefTimer(this.renewTimer);
  }

  /** Mint a fresh receive URL for the same relay while the old socket stays up. */
  private ensureFresh(): Promise<void> {
    this.connecting ??= this.connect().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private scheduleReconnect(backoffMs?: number): void {
    if (this.reconnectTimer || this.closed) return;
    const delay =
      backoffMs ??
      Math.min(
        RECONNECT_MAX_MS,
        this.reconnectBaseMs * 2 ** this.reconnectAttempts,
      );
    if (backoffMs === undefined) this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.closed || this.routes.size === 0) return;
      // Share any renewal already in flight. A failed attempt schedules its retry.
      void this.ensureFresh();
    }, delay);
    unrefTimer(this.reconnectTimer);
  }

  private scheduleIdleClose(): void {
    if (this.routes.size > 0 || this.closed) return;
    this.clearTimer("idleTimer");
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.routes.size === 0) {
        this.clearTimer("renewTimer");
        this.closeSocket();
      }
    }, this.idleCloseMs);
    unrefTimer(this.idleTimer);
  }

  private closeSocket(): void {
    const openingSocket = this.openingSocket;
    this.openingSocket = undefined;
    if (openingSocket) this.detach(openingSocket);
    this.finishOpening?.();
    this.finishOpening = undefined;
    const connection = this.activeConnection;
    this.activeConnection = undefined;
    if (connection) this.detach(connection.socket);
  }

  private detach(socket: RelaySocket): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = () => {};
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }

  private clearTimer(
    name: "renewTimer" | "reconnectTimer" | "idleTimer",
  ): void {
    const timer = this[name];
    if (timer) clearTimeout(timer);
    this[name] = undefined;
  }
}

function backoffFor(response: Response): number {
  if (response.status === 429) {
    const seconds = Number(response.headers.get("Retry-After"));
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  }
  return UNAVAILABLE_BACKOFF_MS;
}

function parseRelayAccess(
  value: unknown,
  relayId: string,
): RelayAccess | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  const { relay_id, connection_url, expires_at } = body;
  if (
    typeof relay_id !== "string" ||
    relay_id.toLowerCase() !== relayId ||
    typeof connection_url !== "string" ||
    !connection_url.startsWith("wss://") ||
    typeof expires_at !== "number"
  ) {
    return undefined;
  }
  return {
    url: connection_url,
    expiresAt: expires_at * 1_000,
  };
}

interface RelayEvent {
  operationId: string;
  sequence: number;
  message: string;
  stage?: string;
}

function parseEvent(data: unknown): RelayEvent | undefined {
  let text: string;
  if (typeof data === "string") text = data;
  else if (data instanceof ArrayBuffer || data instanceof Uint8Array)
    text = new TextDecoder().decode(data);
  else return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const event = value as Record<string, unknown>;
  if (
    event.version !== 1 ||
    typeof event.operation_id !== "string" ||
    typeof event.message !== "string" ||
    typeof event.sequence !== "number" ||
    !Number.isInteger(event.sequence) ||
    event.sequence < 1
  ) {
    return undefined;
  }
  const stage =
    typeof event.stage === "string" && /^[a-z_]{1,32}$/.test(event.stage)
      ? event.stage
      : undefined;
  return {
    operationId: event.operation_id.toLowerCase(),
    sequence: event.sequence,
    message: event.message.slice(0, MAX_MESSAGE_LENGTH),
    ...(stage ? { stage } : {}),
  };
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  // Background maintenance must not keep a CLI process alive.
  (timer as { unref?: () => void }).unref?.();
}
