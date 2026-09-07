# R3B repository targets

Status: implementing the user's settled independent increment, based on freshly
fetched origin/main ad4fabe. No product decisions remain.

Outcome: shared CLI/MCP direct targets support GitHub, Codeberg, and nested
GitLab namespaces, preserving provider and exact refs in output and follow-ups.

Verified ownership: repository-target.ts parses and formats; navigation/search
parsers feed shared request builders, resolve rejects canonical inputs, and diff
uses navigation parsing. Search presentation contains GitHub prefix branches;
search response label formatting currently infers GitHub from bare labels.
Remove that inference and use explicit response identity where available.
Package parsing and backend repoUrl/gitRef contracts remain unchanged. Changelog
URL fields receive wording changes only. No new infrastructure or dependencies.

Steps: extend the immutable grammar table and path validators; add parser and
consumer parity/regression coverage; update contextual descriptions and canonical
skills; regenerate/check plugin assets; update durable docs and one atomic minor
fragment for both artifacts; run focused/full tests, typecheck, build, package
validation, source/built smoke, targeted agent evals, and built dev/production
provider/package/body checks; conduct one fresh Claude review pass, fix valid
findings, commit/push and open a draft PR.

Assumptions/unknowns: live fixture identities and authentication availability
must be verified locally without displaying credentials. GitLab web paths use
its /-/ separator; namespace grammar must reject that separator. Ref parsing
must happen before URL normalization so dot paths and encoded components cannot
silently become another repository. Existing GitHub shorthand and HTTP remain.
Public skill updates and production queries are explicitly authorized in this
handoff. No backend or hosted-server edits, versions, merge, or publication.

Completion: transfer observed architecture and evidence to implementation docs,
then delete this temporary plan before delivery. Report live limitations honestly.
