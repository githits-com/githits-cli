# Review Guidelines

Checklist for reviewing code changes in githits-cli.

## Architecture

- [ ] Architecture is sound and meets guidelines (see `ARCHITECTURAL_GUIDELINES.md`)
- [ ] Implementation is easy to understand
- [ ] Code is in correct modules, no unnecessary duplication
- [ ] Services are properly abstracted for testing

## Code Quality

- [ ] TypeScript types are defined for all parameters and returns
- [ ] Types are as narrow as possible (avoid `any`, prefer specific unions)
- [ ] Functions follow single responsibility principle
- [ ] Error handling is consistent and uses shared utilities

## Testing

- [ ] Good test coverage for new functionality
- [ ] All tests pass (`bun test`)
- [ ] Tests mock services at interface level
- [ ] Error paths are tested

## Documentation

- [ ] JSDoc comments for public functions
- [ ] Comments explain "why" not just "what"
- [ ] Implementation docs updated if needed
- [ ] CLAUDE.md updated if patterns change

## Build & Lint

- [ ] `bun run build` succeeds
- [ ] No TypeScript errors
- [ ] Code is formatted consistently
- [ ] No unused imports or variables

## Commit Quality

- [ ] Commit message is descriptive with context
- [ ] Changes are logically grouped
- [ ] No unrelated changes mixed in
