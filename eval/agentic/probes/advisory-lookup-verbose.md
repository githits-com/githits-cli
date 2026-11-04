# Workload: Verbose advisory evidence

Inspect `githits vulns CVE-2026-26996 --verbose` as a human would read it.
For minimatch 3.1.2, report the package-page link, affected branch and
source-reported fix, distinguishing that evidence from the source description's
newest-branch fix. Keep the requested CVE and any alias identities clear.

From the expanded repository evidence, report the first three and last three
version/tag labels as displayed and explain what the commit events establish.
Distinguish a source fix event from a range boundary and a verified safe upgrade.
Use the readable output; request JSON only if a needed fact is absent. Keep the
answer compact and do not change files.
