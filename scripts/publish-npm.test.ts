import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  type AvailabilityDependencies,
  publishNpm,
  waitForNpmAvailability,
} from "./publish-npm.js";

const pkg = { name: "githits", version: "0.14.0" };

function createDependencies(responses: Response[] = [Response.json(pkg)]) {
  let elapsed = 0;
  const fetch = mock(async (): Promise<Response> => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  });
  const sleep = mock(async (ms: number): Promise<void> => {
    elapsed += ms;
  });
  const dependencies: AvailabilityDependencies = {
    fetch,
    sleep,
    now: (): number => elapsed,
    log: mock((): void => {}),
  };
  return { dependencies, fetch, sleep };
}

describe("npm publication completion", () => {
  it("accepts an immediately available exact version without sleeping", async () => {
    const { dependencies, fetch, sleep } = createDependencies();
    await waitForNpmAvailability(pkg, dependencies);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://registry.npmjs.org/githits/0.14.0",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  it("waits through scanning 404s until the version becomes available", async () => {
    const { dependencies, fetch, sleep } = createDependencies([
      new Response(null, { status: 404 }),
      new Response(null, { status: 404 }),
      Response.json(pkg),
    ]);
    await waitForNpmAvailability(pkg, dependencies);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[15_000], [15_000]]);
  });

  it("addresses the exact scoped package version without sending credentials", async () => {
    const scoped = { ...pkg, name: "@githits/mcp" };
    const { dependencies, fetch } = createDependencies([Response.json(scoped)]);
    await waitForNpmAvailability(scoped, dependencies);
    expect(fetch).toHaveBeenCalledWith(
      "https://registry.npmjs.org/%40githits%2Fmcp/0.14.0",
      { signal: expect.any(AbortSignal) },
    );
  });

  it("fails after 20 minutes when the version stays unavailable", async () => {
    const { dependencies, fetch, sleep } = createDependencies(
      Array.from({ length: 80 }, () => new Response(null, { status: 404 })),
    );
    await expect(waitForNpmAvailability(pkg, dependencies)).rejects.toThrow(
      "githits@0.14.0 is still unavailable after 20 minutes",
    );
    expect(fetch).toHaveBeenCalledTimes(80);
    expect(sleep).toHaveBeenCalledTimes(80);
    expect(dependencies.now()).toBe(20 * 60_000);
  });

  it("counts HTTP time against the deadline and shortens the last wait", async () => {
    let elapsed = 0;
    const { dependencies, fetch, sleep } = createDependencies();
    dependencies.now = (): number => elapsed;
    fetch.mockImplementation(async (): Promise<Response> => {
      elapsed = 20 * 60_000 - 5_000;
      return new Response(null, { status: 404 });
    });
    sleep.mockImplementation(async (ms: number): Promise<void> => {
      elapsed += ms;
    });
    await expect(waitForNpmAvailability(pkg, dependencies)).rejects.toThrow(
      "after 20 minutes",
    );
    expect(sleep.mock.calls).toEqual([[5_000]]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a verified available response when the clock reaches the deadline", async () => {
    let elapsed = 0;
    const { dependencies, fetch } = createDependencies();
    dependencies.now = (): number => elapsed;
    fetch.mockImplementation(async (): Promise<Response> => {
      elapsed = 20 * 60_000;
      return Response.json(pkg);
    });
    await waitForNpmAvailability(pkg, dependencies);
    expect(dependencies.log).toHaveBeenCalledWith(
      "githits@0.14.0 is publicly available on npm.",
    );
  });

  it.each(["headers", "body"])(
    "reports the overall deadline when it aborts the last request's %s",
    async (phase) => {
      // Drive expiry deterministically; a 1ms unref timer can stall Bun on Windows.
      const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => {
        const controller = new AbortController();
        queueMicrotask(() =>
          controller.abort(new DOMException("Timed out", "TimeoutError")),
        );
        return controller.signal;
      });
      let clockReads = 0;
      const { dependencies } = createDependencies();
      // Begin the first request with just one millisecond left in the overall budget.
      dependencies.now = (): number =>
        clockReads++ === 0 ? 0 : 20 * 60_000 - 1;
      dependencies.fetch = async (
        _url: string,
        options: RequestInit,
      ): Promise<Response> => {
        const signal = options.signal!;
        // Like fetch, the mock must handle a signal that expired before subscription.
        if (signal.aborted) {
          dependencies.now = (): number => 20 * 60_000;
          throw signal.reason;
        }
        const abort = new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              dependencies.now = (): number => 20 * 60_000;
              reject(signal.reason);
            },
            { once: true },
          );
        });
        if (phase === "headers") return abort;
        return new Response(
          new ReadableStream({
            start(controller): void {
              void abort.catch((error: unknown) => controller.error(error));
            },
          }),
        );
      };
      try {
        await expect(waitForNpmAvailability(pkg, dependencies)).rejects.toThrow(
          "Check npm's package status before rerunning the release",
        );
      } finally {
        timeout.mockRestore();
      }
    },
  );

  it.each([401, 403, 429, 500, 503])(
    "fails immediately on HTTP %s",
    async (status) => {
      const { dependencies, fetch, sleep } = createDependencies([
        new Response("Response bodies must not reach errors", { status }),
      ]);
      await expect(waitForNpmAvailability(pkg, dependencies)).rejects.toThrow(
        `npm availability check failed with HTTP ${status}`,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("fails on a transport error without retrying", async () => {
    const { dependencies, fetch, sleep } = createDependencies();
    fetch.mockRejectedValue(new Error("connection failed"));
    await expect(waitForNpmAvailability(pkg, dependencies)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([
    { ...pkg, name: "other-package" },
    { ...pkg, version: "0.13.0" },
    { error: "not found" },
  ])(
    "rejects metadata that does not identify the requested release: %j",
    async (body) => {
      const { dependencies } = createDependencies([Response.json(body)]);
      await expect(waitForNpmAvailability(pkg, dependencies)).rejects.toThrow(
        "npm returned unexpected package metadata",
      );
    },
  );

  it("rejects malformed JSON without exposing the response", async () => {
    const { dependencies } = createDependencies([new Response("private body")]);
    await expect(waitForNpmAvailability(pkg, dependencies)).rejects.toThrow(
      "npm returned invalid package metadata",
    );
  });

  it("does not finish publication while npm is still scanning", async () => {
    const { dependencies } = createDependencies([
      new Response(null, { status: 404 }),
      Response.json(pkg),
    ]);
    const publish = mock(async () => ({ exitCode: 0, stderr: "" }));
    await publishNpm(pkg, publish, dependencies);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(dependencies.now()).toBe(15_000);
  });

  it("recovers the observed staged-version conflict by checking availability", async () => {
    const { dependencies, fetch } = createDependencies([
      new Response(null, { status: 404 }),
      Response.json(pkg),
    ]);
    const publish = mock(async () => ({
      exitCode: 1,
      stderr:
        'npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/githits - Cannot publish over previously staged version "0.14.0".\n',
    }));
    await publishNpm(pkg, publish, dependencies);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not count a staged conflict as completed publication if npm stays unavailable", async () => {
    const { dependencies } = createDependencies(
      Array.from({ length: 80 }, () => new Response(null, { status: 404 })),
    );
    await expect(
      publishNpm(
        pkg,
        async () => ({
          exitCode: 1,
          stderr:
            'npm error code E409\nCannot publish over previously staged version "0.14.0".\n',
        }),
        dependencies,
      ),
    ).rejects.toThrow("after 20 minutes");
  });

  it.each([
    "npm error code E401\nUnauthorized",
    "npm error code E409\nUnrelated conflict",
    'npm error code E409\nCannot publish over previously staged version "0.13.0".',
    'npm error code E403\nCannot publish over previously staged version "0.14.0".',
  ])(
    "does not treat an unrelated publish failure as acceptance: %s",
    async (stderr) => {
      const { dependencies, fetch } = createDependencies();
      await expect(
        publishNpm(pkg, async () => ({ exitCode: 1, stderr }), dependencies),
      ).rejects.toThrow("npm publish failed with exit code 1");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
