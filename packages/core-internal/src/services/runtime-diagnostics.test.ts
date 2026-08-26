import { describe, expect, it, mock } from "bun:test";
import {
  type ServiceDiagnostics,
  withServiceDiagnostics,
} from "./runtime-diagnostics.js";

function createDiagnostics(
  withOperation: ServiceDiagnostics["withOperation"],
): ServiceDiagnostics {
  return {
    withOperation,
    isEnabled: () => false,
    debug: () => undefined,
  };
}

describe("withServiceDiagnostics", () => {
  it("executes directly without diagnostics", async () => {
    const operation = mock(async () => "result");

    await expect(
      withServiceDiagnostics(undefined, "test.operation", operation),
    ).resolves.toBe("result");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("delegates the operation and name to injected diagnostics", async () => {
    const operation = mock(async () => "result");
    const calls: string[] = [];
    const withOperation: ServiceDiagnostics["withOperation"] = async <T>(
      name: string,
      callback: () => Promise<T>,
    ) => {
      calls.push(name);
      return callback();
    };
    const diagnostics = createDiagnostics(withOperation);

    await expect(
      withServiceDiagnostics(diagnostics, "test.operation", operation),
    ).resolves.toBe("result");
    expect(calls).toEqual(["test.operation"]);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("preserves the original error without diagnostics", async () => {
    const error = new Error("original");
    const operation = mock(async () => {
      throw error;
    });

    await expect(
      withServiceDiagnostics(undefined, "test.operation", operation),
    ).rejects.toBe(error);
  });

  it("preserves the original error from injected diagnostics", async () => {
    const error = new Error("original");
    const operation = mock(async () => {
      throw error;
    });
    const withOperation: ServiceDiagnostics["withOperation"] = async <T>(
      _name: string,
      callback: () => Promise<T>,
    ) => callback();

    await expect(
      withServiceDiagnostics(
        createDiagnostics(withOperation),
        "test.operation",
        operation,
      ),
    ).rejects.toBe(error);
  });
});
