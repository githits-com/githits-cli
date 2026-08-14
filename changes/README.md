# Unreleased Changelog Fragments

Normal pull requests record each notable user-, agent-, operator-, or
public-API-visible change in a new file instead of editing `CHANGELOG.md`. Use:

```text
changes/<pr-number-or-unique-slug>.<category>.md
```

Valid categories are `added`, `changed`, `deprecated`, `removed`, `fixed`, and
`security`. Use a lowercase, hyphenated unique name and this exact structure:

```markdown
---
"githits": patch
"@githits/mcp": none
---

- **Short title** - Describe the user-visible behavior and important rollout or
  compatibility impact.
```

Each public artifact must have an explicit `none`, `patch`, `minor`, or `major`
impact. Add future independently versioned public artifacts to every fragment.
Keep the body to one concise Markdown bullet. Never edit another change's
fragment.

A pull request that fully reverts an unreleased change removes that change's
fragment instead of adding a release note for behavior that will not ship.

A release PR verifies the fragments against the complete tag-to-HEAD ranges and
computes the highest bump per artifact. A fragment with non-`none` impact on
multiple artifacts must be released for all of them together; never consume it
partially. Group entries by category into each affected artifact's versioned
`CHANGELOG.md` section and delete only the consumed fragments. Leave fragments
unrelated to that release untouched. A fragment with `none` for every artifact
documents repository or release-operation impact; it does not trigger a release
and is consumed into the next `githits` release.
