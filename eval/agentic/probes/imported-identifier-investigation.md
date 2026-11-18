# Workload: Imported Identifier Investigation

In `npm:express@5.2.1`, investigate how Express uses the standalone `router`
package.

- Identify both import sites by exact file path and line number.
- Explain how the application creates its router on first access and reuses it
  on later accesses. Identify the routing settings passed to the constructor and
  explain where their values come from.
- Explain which public Express exports are supplied by the second import and
  what each export refers to.

Cite the source file and line range supporting each explanation. Report the
served source snapshot and any evidence or coverage limits that affect your
conclusions.
