# Documentation Guidelines

## Audience

This documentation serves two audiences with different reading patterns:

**Humans** read documentation once to understand a system, then return occasionally to find specific references. They benefit from clear explanations upfront and well-organized reference material they can locate quickly.

**LLM agents** read documentation when explicitly pointed to it or when searching for relevant terms. They need to gain sufficient understanding from a single read to make sensible decisions about the codebase.

## Writing Principles

### Focus on Intent and Explanation

Explain _why_ patterns exist, not just _how_ they work. A reader should understand:

- What problem the pattern solves
- Why this approach was chosen over alternatives
- When to use it versus other options

Avoid catalogue-style documentation that lists facts without context.

### Frontload Understanding

Put the most important context first:

1. **Purpose** — what this document explains
2. **Background** — why things are the way they are
3. **Decision criteria** — how to choose between options
4. **Implementation details** — the mechanics
5. **References** — files to explore further

A reader who stops halfway should still have gained the core understanding.

### Use References, Not Code Dumps

Point to canonical implementations rather than copy-pasting code:

**Prefer**: "See `src/tools/search.ts` for the implementation pattern"

**Avoid**: Embedding 50 lines of code that will drift out of sync

Brief code snippets (under 10 lines) are acceptable when they illustrate a specific concept that's hard to explain in prose.

### Assume Library Familiarity

Readers likely know common TypeScript libraries. Don't explain what these are.

Do explain our patterns and conventions for using them — that's the knowledge readers lack.

### Enable Good Decisions

After reading, an LLM should be able to:

- Choose the appropriate pattern for a new task
- Understand why existing code is structured a certain way
- Know where to look for reference implementations

### Highlight Critical Rules

If there's one thing readers must not forget, call it out explicitly:

> **Keep modules focused.** Each module should have a single responsibility. If a module grows large, split it.

This helps both humans scanning for key points and LLMs identifying the most important constraints.

### Use Tables for Reference Material

Tables work well for information humans will look up later:

- Available options
- Comparison of approaches
- File references with brief descriptions

Keep prose for explanation, tables for enumeration.

## Document Structure

```markdown
# Topic Name

## Purpose

One paragraph: what this document explains and why it matters.

## Background

Context, evolution of the system, why current patterns exist.

## [Core Concepts / Patterns / Architecture]

The main content — explanations, decisions, trade-offs.

## How to Choose / When to Use

Decision criteria for the reader.

## Implementation

How to apply the patterns — brief, with references to examples.

## Troubleshooting (if applicable)

Common issues and how to resolve them.

## Related Documentation

Links to related docs.

## Key Reference Files

Table of files to explore, with what each demonstrates.
```

## What to Document

Prioritize topics where:

- Decisions aren't obvious from reading code alone
- Multiple valid approaches exist and we've chosen one
- Historical context explains current patterns
- Mistakes are common without guidance

Low-value documentation:

- Restating what code clearly shows
- API references that duplicate code comments
- Step-by-step tutorials for simple tasks

## Maintenance

When code changes, update documentation if:

- The "why" has changed
- Decision criteria are now different
- New options exist that readers should know about

Don't update documentation just because implementation details changed — references to files still work, and the concepts remain valid.
