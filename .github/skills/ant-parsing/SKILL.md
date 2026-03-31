---
name: ant-parsing
description: "Apache Ant build.xml parsing — XML structure, target extraction, import/include resolution, property substitution, dual parser strategy (Java + XML regex). Use when modifying the parser or working with build.xml files."
---
# Ant Build File Parsing

## When to Use
- Modifying the XML regex parser (`AntParserService.parseWithXml()`)
- Modifying the Java parser (`AntParser.java`)
- Adding support for new Ant XML elements
- Debugging parsing failures
- Understanding build.xml structure

## Ant Build File Structure

### Basic build.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<project name="myproject" default="build" basedir=".">
    <description>Project description</description>

    <property name="src.dir" value="src"/>
    <property name="build.dir" value="build"/>

    <target name="clean" description="Clean build directory">
        <delete dir="${build.dir}"/>
    </target>

    <target name="compile" depends="clean" description="Compile sources">
        <javac srcdir="${src.dir}" destdir="${build.dir}"/>
    </target>

    <target name="build" depends="compile" description="Build project">
        <jar destfile="output.jar" basedir="${build.dir}"/>
    </target>
</project>
```

### Import/Include
```xml
<!-- Import: targets can override -->
<import file="common-build.xml"/>

<!-- Include: targets are prefixed with filename -->
<include file="shared/testing.xml"/>
```

### Target Attributes
| Attribute | Purpose |
|-----------|---------|
| `name` | Required. Unique target identifier |
| `description` | Optional. Shown in UI for documented targets |
| `depends` | Comma-separated list of prerequisite targets |
| `if` | Only execute if property is set |
| `unless` | Only execute if property is NOT set |

## Dual Parser Strategy

### XML Parser (Default)
- Fast regex-based extraction in `AntParserService.parseWithXml()`
- Follows `<import>` and `<include>` elements up to `importDepth` limit
- Circular import detection via visited paths set
- Cannot resolve Ant properties (`${prop.name}` stays as-is)

### Java Parser (Optional)
- Uses Apache Ant 1.10.14 API via `AntParser.java`
- Full property resolution (system, file, built-in properties)
- Follows all imports regardless of depth
- Slower — requires JDK 11+ at runtime

### Both parsers return identical structure:
```typescript
interface AntBuildInfo {
    projectName: string;
    defaultTarget: string;
    baseDir: string;
    description: string | null;
    buildFile: string;
    targets: AntTarget[];
}
```

## Adding Parser Support for New Elements

1. **XML parser**: Add regex pattern in `parseXmlFile()` within `AntParserService.ts`
2. **Java parser**: Update `AntParser.java` to extract the new data from Ant API
3. **Types**: Add field to `AntBuildInfo` or `AntTarget` in BOTH TypeScript and Java
4. **Test**: Verify both parsers return the same result for the same input file
