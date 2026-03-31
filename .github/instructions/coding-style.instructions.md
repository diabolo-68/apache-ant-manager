---
description: "Use when writing or modifying TypeScript, Java, or CSS code. Covers strict typing, naming conventions, import ordering, async patterns, Java DTOs, and CSS variable usage."
applyTo: ["**/*.ts", "**/*.java", "**/*.css"]
---
# Coding Style

## TypeScript
- **Strict mode**: `tsconfig.json` has `strict: true`. No `any` types. No type assertions (`as`) unless absolutely necessary with a comment explaining why.
- **Naming**: PascalCase for classes and interfaces, camelCase for functions and variables, UPPER_SNAKE for constants.
- **Imports**: Group by: 1) `vscode` module, 2) node built-ins, 3) project imports. Use relative paths for project imports.
- **Async**: Always use `async/await` over raw Promises. Handle errors with try/catch.
- **Strings**: Use single quotes for TypeScript. Use template literals for interpolation.
- **Equality**: Always use `===` and `!==`. ESLint enforces `eqeqeq`.
- **Braces**: Always use braces for control flow, even single-line. ESLint enforces `curly`.

## Java
- **Version**: JDK 11+ syntax. No preview features.
- **Naming**: PascalCase for classes, camelCase for methods and fields.
- **DTOs**: Plain classes with getters/setters. No Lombok or other annotation processors.
- **Serialization**: Gson only. No manual JSON string building.

## CSS
- **Variables**: Always use VS Code CSS variables (`--vscode-editor-background`, `--vscode-button-background`, etc.) for colors.
- **No hardcoded colors**: Everything must adapt to the user's VS Code theme.
- **Units**: Use `px` for borders and small spacing, `rem` for text-relative sizing.

## File Organization
- One class per file (panels, services).
- Types grouped in `src/types/antTypes.ts`.
- Shared styles in `media/style.css`.
