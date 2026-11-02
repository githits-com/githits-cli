# Workload: Correcting unavailable package versions and repository refs

Inspect the direct dependencies of npm package express at version 99.99.99. Also inspect README.md in the public expressjs/express GitHub
repository at ref v99.99.99-nope.

For each request, report whether the exact requested version or ref exists.
If a request fails, report the evidence-backed correction and how to request
it using the same tool. Do not silently replace either requested input, and
keep published package versions distinct from repository refs.
