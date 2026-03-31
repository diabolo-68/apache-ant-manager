---
description: "Use when diagnosing and fixing TypeScript, Webpack, ESLint, Java, or Maven build errors. Covers both build systems in this dual-runtime extension."
tools: [read, search, execute]
---
You fix build errors for the Apache Ant Manager VS Code extension. The project has two build systems:

## TypeScript/Webpack (main extension)
- Build: `npm run compile` (webpack)
- Watch: `npm run watch` (webpack --watch)
- Lint: `npm run lint` (eslint)
- Config: `webpack.config.js` (target: node, entry: `./src/extension.ts`, output: `dist/extension.js`)
- TypeScript: `tsconfig.json` (strict mode, ES2022, commonjs modules)
- Common issues: missing imports, type errors, webpack loader failures, ESLint violations

## Java/Maven (parser component)
- Build: `cd java && mvn package`
- Config: `java/pom.xml` (JDK 11+, Ant 1.10.14, Gson 2.10.1, shade plugin)
- Common issues: dependency resolution, Java version mismatch, shade plugin conflicts

## Debugging Steps
1. Read the error output carefully
2. Identify which build system is affected (TypeScript or Java)
3. Check the relevant config file
4. Fix the root cause, don't suppress errors
5. Run the build again to verify
