---
description: "Use when working on webview security, file path validation, XML parsing safety, task execution, or dependency audits. Covers CSP nonce, innerHTML prevention, XXE, and shell injection."
applyTo: ["src/panels/**", "src/services/**"]
---
# Security Rules

## Webview Security
- **Content Security Policy**: Every webview MUST include a nonce-based CSP header. Generate a unique nonce per render in `_getHtmlForWebview()`.
- **No innerHTML**: Never use `innerHTML` with user-supplied or file-derived data in webview JavaScript. Use `textContent` or DOM manipulation methods.
- **Script sources**: Only allow `nonce`-tagged inline scripts. No external script sources.
- **Style sources**: Only allow the webview's own stylesheet URI and `nonce`-tagged inline styles.

## File Path Security
- **Path traversal**: Always validate that resolved file paths remain within the workspace. Use `vscode.workspace.workspaceFolders` bounds checking.
- **Build file validation**: Use `isAntBuildFile()` to verify a file is a valid Ant build file before parsing.
- **No arbitrary execution**: Never pass unsanitized user input to `child_process.exec()` or similar. The Java parser receives only a file path argument.

## XML Parsing Security
- **XXE prevention**: The XML regex parser does not evaluate entities (safe by design). If switching to a DOM parser, disable external entity resolution.
- **Input size**: Consider adding a size limit for parsed XML files to prevent resource exhaustion.

## Task Execution Security
- **Shell injection**: Task commands are constructed using VS Code's Task API which handles escaping. Never build shell commands via string concatenation.
- **Environment variables**: Only pass user-configured environment variables. Never leak extension host environment secrets to tasks.

## Dependency Security
- **npm**: Run `npm audit` periodically. Keep dependencies up to date.
- **Maven**: Keep Ant and Gson versions current. Check for CVEs in `java/pom.xml` dependencies.
