---
description: "Use when creating commits, writing commit messages, preparing pull requests, or managing git branches. Covers conventional commits, branch naming, pre-commit checks, and CHANGELOG format."
---
# Git Workflow

## Commit Messages
Use conventional commits:
- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation only
- `refactor:` — Code change that neither fixes a bug nor adds a feature
- `test:` — Adding or updating tests
- `chore:` — Build process, tooling, dependencies

Examples:
```
feat: add target filtering in configuration panel
fix: resolve path resolution for multi-root workspaces
docs: update README with new configuration options
refactor: extract message types from AntConfigurationPanel
test: add parser tests for import/include resolution
chore: update Ant dependency to 1.10.15
```

## Branches
- `main` — Stable release branch
- `feat/<name>` — Feature branches
- `fix/<name>` — Bug fix branches

## Before Committing
1. `npm run lint` — No ESLint errors
2. `npm run compile` — Clean build
3. `npm test` — All tests pass
4. `cd java && mvn package` — Java builds (if Java files changed)
5. Update `CHANGELOG.md` if the change is user-visible

## CHANGELOG Format
Follow Keep a Changelog format:
```markdown
## [Unreleased]

### Added
- New feature description

### Fixed
- Bug fix description

### Changed
- Changed behavior description
```
