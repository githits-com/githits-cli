# Workload: Advisory-to-package triage

For CVE-2026-26996 and CVE-2023-4863, identify the linked package ecosystems,
package-page links and source-reported fixed versions. For the first advisory,
include its older 3.x branch rather than reporting only its newest branches.
Keep the requested CVE identities clear when source records use other IDs, and
report numeric CVSS scores only when supplied, without substituting severity-label approximations.

I also need to build a small triage card from machine-readable evidence: explain
which fields connect each package's affected/fixed ranges to the advisory sources
and how I can tell whether package coverage is incomplete. Keep the answer compact
and distinguish source-reported fixes from verified safe upgrades. Do not change files.
