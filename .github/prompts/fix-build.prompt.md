---
description: "Diagnose and fix build errors in TypeScript/Webpack or Java/Maven"
agent: "agent"
tools: [execute]
---
Diagnose and fix the following build error:

${{input}}

Steps:

1. **Identify the build system**: TypeScript/Webpack (`npm run compile`) or Java/Maven (`cd java && mvn package`)
2. **Read relevant config**: [tsconfig.json](../../tsconfig.json), [webpack.config.js](../../webpack.config.js), or [pom.xml](../../java/pom.xml)
3. **Find root cause**: Read the error message carefully. Check for:
   - Missing imports or type errors
   - Webpack loader/plugin issues
   - Maven dependency resolution failures
   - Java version mismatches (need JDK 11+)
4. **Fix**: Apply the minimal change that resolves the error
5. **Verify**: Run the build command again to confirm the fix
6. **Check for regressions**: Run `npm test` to ensure nothing else broke
