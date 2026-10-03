# Workload: Bounded Patch Evidence

Inspect raw source changes between public npm `express` versions `4.18.2`
and `5.1.0`. Limit the overview to two changed files. Then inspect patch
content under `lib/` with an aggregate patch budget of 1024 bytes.

Explain which bounds affect the file inventory, returned content, and displayed
patch excerpts. Obtain one full returned patch if available and distinguish
it from content omitted by the source service. State whether the evidence
establishes a complete, safely applicable patch or upgrade compatibility.
