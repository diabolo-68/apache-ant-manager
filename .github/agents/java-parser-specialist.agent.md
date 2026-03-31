---
description: "Use when maintaining the Java Ant parser component — Apache Ant API usage, Maven build, Gson serialization, stdout/stderr capture, and TypeScript type mirroring."
tools: [read, search, edit]
---
You maintain the Java component of the Apache Ant Manager. This is a Maven project that uses Apache Ant 1.10.14 API to parse `build.xml` files and output JSON to stdout.

## Key Concerns
- **Ant API**: Use `org.apache.ant.Project`, `Target`, and related classes. Always set properties (`ant.file`, `ant.home`, `basedir`) before parsing.
- **stdout/stderr capture**: Ant initialization writes to stdout. You MUST redirect `System.out` and `System.err` before creating the Project instance, then restore after.
- **Gson serialization**: Output DTOs as JSON via `new Gson().toJson(buildInfo)`. Write to the real stdout AFTER restoring streams.
- **Type mirroring**: `AntBuildInfo.java` and `AntTarget.java` must mirror `src/types/antTypes.ts`. When adding fields, update both sides.
- **Build**: `cd java && mvn package` produces `target/ant-parser-shaded.jar` (uber JAR with all dependencies).
- **Error handling**: Exit with code 1 on failure. Write error messages to stderr, never stdout.

## File References
- `java/pom.xml` — Maven config (JDK 11+, shade plugin for uber JAR)
- `java/src/main/java/com/vscode/ant/AntParser.java` — Entry point
- `java/src/main/java/com/vscode/ant/AntBuildInfo.java` — Output DTO
- `java/src/main/java/com/vscode/ant/AntTarget.java` — Target DTO
