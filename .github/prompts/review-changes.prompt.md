---
description: "Review current code changes for quality, security, pattern compliance, and type mirroring"
agent: "agent"
---
Review the current code changes in the Apache Ant Manager extension.

Check against these criteria:

## Architecture Compliance
- Services created in extension.ts, injected into panels (never created in panels)
- Panels use singleton `createOrShow()` pattern
- Webview communication uses `postMessage` / `onDidReceiveMessage`

## TypeScript Quality
- No `any` types — proper interfaces from `src/types/antTypes.ts`
- Async operations have error handling
- ESLint compliance (`npm run lint`)

## Security
- Webview CSP includes nonce
- No innerHTML with user data
- File paths validated before use
- No command injection via string concatenation

## Type Mirroring
- TypeScript interface changes mirrored in Java DTOs
- Java DTO changes mirrored in TypeScript interfaces

## Multi-Root Support
- Paths use `${workspaceFolder}` / `${workspaceFolder:NAME}` format
- Feature works in both single-folder and multi-root workspaces

Provide specific file:line references for any issues found.
