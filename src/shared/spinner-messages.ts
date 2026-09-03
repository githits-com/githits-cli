/**
 * Rotating spinner labels per command. Each list cycles every ~2s while
 * a command waits on the GitHits backend, so long requests feel alive.
 */
export const SPINNER_MESSAGES = {
  ask: [
    "Investigating indexed sources...",
    "Tracing the relevant implementation...",
    "Grounding the answer...",
  ],
  example: [
    "Searching real implementations...",
    "Exploring open-source code...",
    "Finding production patterns...",
    "Grounding results...",
  ],
  search: [
    "Exploring repositories...",
    "Tracing symbols...",
    "Inspecting dependencies...",
    "Scanning source code...",
  ],
  code: [
    "Inspecting source code...",
    "Resolving symbols...",
    "Reading dependency internals...",
  ],
  docs: [
    "Reading documentation...",
    "Resolving references...",
    "Collecting package docs...",
  ],
} as const;
