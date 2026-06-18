/**
 * GitHits' /search REST endpoint returns a markdown body whose footer
 * links to the canonical solution page on app.githits.com. The
 * `solution_id` needed for `feedback` is the UUID at the end of that
 * URL. Until the backend exposes it as a structured field, surfaces
 * pluck it out client-side so agents and JSON consumers can call
 * `feedback` without parsing markdown.
 *
 * TODO(backend): have /search return `{ markdown, solution_id }` as
 * a structured payload so this regex can go away.
 */

const SOLUTION_URL_RE = /solutions\/([0-9a-fA-F-]{36})/;

export function extractSolutionId(markdown: string): string | undefined {
  const match = SOLUTION_URL_RE.exec(markdown);
  return match?.[1];
}
