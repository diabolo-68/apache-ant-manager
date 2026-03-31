---
description: "Use when editing type definitions — AntBuildInfo, AntTarget, AntLaunchConfiguration. Ensures TypeScript ↔ Java type mirroring."
applyTo: "src/types/**"
---
# Type Definitions

## Core Interfaces

```typescript
interface AntBuildInfo {
    projectName: string;
    defaultTarget: string;
    baseDir: string;
    description: string | null;
    buildFile: string;
    targets: AntTarget[];
}

interface AntTarget {
    name: string;
    description: string | null;
    dependencies: string[];
    ifCondition: string | null;
    unlessCondition: string | null;
    isDefault: boolean;
}
```

## Type Mirroring Rule
Every change to these interfaces MUST be mirrored in the Java DTOs:
- `AntBuildInfo` → `java/src/main/java/com/vscode/ant/AntBuildInfo.java`
- `AntTarget` → `java/src/main/java/com/vscode/ant/AntTarget.java`

## Nullable Fields
- Use `string | null` in TypeScript, nullable `String` in Java
- Gson serializes null fields as `null` in JSON — TypeScript parser expects this

## Adding New Fields
1. Add to TypeScript interface in `src/types/antTypes.ts`
2. Add matching field + getter/setter in Java DTO
3. Update `AntParser.java` to populate the new field
4. Update `parseWithXml()` in `AntParserService.ts` to populate the new field
5. Rebuild Java: `cd java && mvn package`
