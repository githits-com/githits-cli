export function isProcessExitSentinel(error: unknown): boolean {
  return error instanceof Error && error.message === "process.exit";
}
