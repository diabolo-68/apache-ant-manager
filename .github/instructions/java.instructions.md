---
description: "Use when editing Java parser component — Apache Ant API, Gson serialization, stdout/stderr capture, DTO mirroring with TypeScript."
applyTo: "java/**"
---
# Java Parser Component

## Build
```bash
cd java && mvn package
```
Produces `target/ant-parser-shaded.jar` (uber JAR via maven-shade-plugin).

## stdout/stderr Capture
Ant initialization writes to stdout/stderr. MUST redirect before creating Project:
```java
PrintStream originalOut = System.out;
PrintStream originalErr = System.err;
System.setOut(new PrintStream(new ByteArrayOutputStream()));
System.setErr(new PrintStream(new ByteArrayOutputStream()));
// ... create Project, parse ...
System.setOut(originalOut);
System.setErr(originalErr);
// NOW write JSON to stdout
```

## Type Mirroring
Java DTOs must match TypeScript interfaces in `src/types/antTypes.ts`:
- `AntBuildInfo.java` ↔ `AntBuildInfo` interface
- `AntTarget.java` ↔ `AntTarget` interface

When adding a field: update BOTH sides. Field names must match exactly (Gson uses field names as JSON keys).

## Ant API Usage
- Set required properties: `ant.file`, `ant.home`, `basedir`
- Add a silent `BuildListener` to suppress Ant logging
- Access targets via `project.getTargets()` — returns `Hashtable<String, Target>`

## Error Handling
- Exit with code 1 on any failure
- Write error messages to stderr, NEVER to stdout (stdout is reserved for JSON output)
- The TypeScript side checks exit code and falls back to XML parser on failure
