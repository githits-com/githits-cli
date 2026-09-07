import { readFile } from "node:fs/promises";
import { z } from "zod";

const packageIdentity = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});

interface PackageIdentity {
  name: string;
  version: string;
}

export interface AvailabilityDependencies {
  fetch: (url: string, options: RequestInit) => Promise<Response>;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  log: (message: string) => void;
}

interface PublishResult {
  exitCode: number;
  stderr: string;
}

const availabilityDependencies: AvailabilityDependencies = {
  fetch: (url, options): Promise<Response> => fetch(url, options),
  now: (): number => performance.now(),
  sleep: async (milliseconds): Promise<void> => {
    await Bun.sleep(milliseconds);
  },
  log: (message): void => console.log(message),
};

/** npm accepts uploads before scanning finishes; downstream releases need visibility. */
export async function waitForNpmAvailability(
  pkg: PackageIdentity,
  dependencies: AvailabilityDependencies = availabilityDependencies,
): Promise<void> {
  const deadline = dependencies.now() + 20 * 60_000;
  const label = `${pkg.name}@${pkg.version}`;
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;

  while (dependencies.now() < deadline) {
    const signal = AbortSignal.timeout(
      Math.max(1, Math.ceil(Math.min(15_000, deadline - dependencies.now()))),
    );
    try {
      const response = await dependencies.fetch(url, { signal });

      if (response.status === 200) {
        const metadata = await response.json().catch(() => {
          throw new Error("npm returned invalid package metadata");
        });
        const parsed = packageIdentity.safeParse(metadata);
        if (
          !parsed.success ||
          parsed.data.name !== pkg.name ||
          parsed.data.version !== pkg.version
        ) {
          throw new Error("npm returned unexpected package metadata");
        }
        dependencies.log(`${label} is publicly available on npm.`);
        return;
      }

      await response.body?.cancel();
      if (response.status !== 404) {
        throw new Error(
          `npm availability check failed with HTTP ${response.status}`,
        );
      }
    } catch (error) {
      // A request stopped by the overall deadline needs the recovery message below.
      if (signal.aborted && dependencies.now() >= deadline) break;
      throw error;
    }

    dependencies.log(`${label} is not public yet; waiting for npm processing.`);
    await dependencies.sleep(
      Math.max(0, Math.min(15_000, deadline - dependencies.now())),
    );
  }

  throw new Error(
    `${label} is still unavailable after 20 minutes. npm may still be scanning or holding the upload. Check npm's package status before rerunning the release; downstream publication has not continued.`,
  );
}

/** Upload once, then verify availability, including recovery of an accepted pending upload. */
export async function publishNpm(
  pkg: PackageIdentity,
  publish: () => Promise<PublishResult>,
  dependencies: AvailabilityDependencies = availabilityDependencies,
): Promise<void> {
  const result = await publish();
  if (result.exitCode !== 0) {
    // Matches the modern npm output used by the pinned Node release runtime.
    const alreadyStaged =
      /(?:^|\n)npm error code E409\r?(?:\n|$)/.test(result.stderr) &&
      result.stderr.includes(
        `Cannot publish over previously staged version "${pkg.version}".`,
      );
    if (!alreadyStaged) {
      throw new Error(`npm publish failed with exit code ${result.exitCode}`);
    }
    dependencies.log(`${pkg.name}@${pkg.version} was already accepted by npm.`);
  }
  await waitForNpmAvailability(pkg, dependencies);
}

if (import.meta.main) {
  try {
    const pkg = packageIdentity.parse(
      JSON.parse(await readFile("package.json", "utf8")),
    );
    await publishNpm(pkg, async (): Promise<PublishResult> => {
      const child = Bun.spawn(["npm", "publish", "--access", "public"], {
        stdout: "inherit",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      process.stderr.write(stderr);
      return { exitCode, stderr };
    });
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "npm publication failed",
    );
    process.exitCode = 1;
  }
}
