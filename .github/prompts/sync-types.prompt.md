---
description: "Synchronize TypeScript interfaces and Java DTOs after a type change"
agent: "agent"
---
Synchronize the TypeScript and Java type definitions for the Apache Ant Manager extension.

${{input}}

## Files to Sync

| TypeScript | Java |
|-----------|------|
| [src/types/antTypes.ts](../../src/types/antTypes.ts) | [AntBuildInfo.java](../../java/src/main/java/com/vscode/ant/AntBuildInfo.java) |
| `AntBuildInfo` interface | `AntBuildInfo` class |
| `AntTarget` interface | [AntTarget.java](../../java/src/main/java/com/vscode/ant/AntTarget.java) |

## Steps

1. **Read both sides**: Compare TypeScript interfaces with Java DTOs field-by-field
2. **Identify mismatches**: Find fields present in one side but not the other
3. **Apply changes**: Update the lagging side to match
4. **Update parsers**: If fields were added:
   - Update `AntParser.java` to populate new fields from Ant API
   - Update `parseWithXml()` in `AntParserService.ts` to extract new fields from XML
5. **Rebuild Java**: Run `cd java && mvn package`
6. **Verify**: Run `npm run compile` to check TypeScript compilation
