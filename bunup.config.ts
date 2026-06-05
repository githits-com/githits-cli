import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "bunup";

interface PackageJson {
  dependencies?: Record<string, string>;
  name?: string;
  private?: boolean;
}

const privateWorkspacePackages = getPrivateWorkspacePackageNames();
const privateWorkspacePackageNames = [...privateWorkspacePackages].sort();

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as PackageJson;

const externalDependencies = Object.keys(packageJson.dependencies ?? {})
  .filter(
    (dependencyName: string): boolean =>
      !privateWorkspacePackages.has(dependencyName),
  )
  .map(
    (dependencyName: string): RegExp =>
      dependencyNameToExternalPattern(dependencyName),
  );

function dependencyNameToExternalPattern(dependencyName: string): RegExp {
  return new RegExp(`^${escapeRegExp(dependencyName)}(?:/.*)?$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getPrivateWorkspacePackageNames(): Set<string> {
  const workspacePackageDirectories = readdirSync(
    new URL("./packages/", import.meta.url),
    { withFileTypes: true },
  ).filter((directoryEntry) => directoryEntry.isDirectory());

  return new Set(
    workspacePackageDirectories.flatMap((directoryEntry): string[] => {
      const workspacePackageJson = JSON.parse(
        readFileSync(
          new URL(
            `./packages/${directoryEntry.name}/package.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ) as PackageJson;

      return workspacePackageJson.private === true && workspacePackageJson.name
        ? [workspacePackageJson.name]
        : [];
    }),
  );
}

export default defineConfig({
  dts: {
    entry: "src/index.ts",
    resolve: privateWorkspacePackageNames,
  },
  exports: true,
  external: externalDependencies,
  minifyWhitespace: true,
  packages: "bundle",
  target: "node",
});
