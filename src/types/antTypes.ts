/**
 * Represents the parsed information from an Ant build file.
 */
export interface AntBuildInfo {
    projectName: string;
    defaultTarget: string;
    baseDir: string;
    description: string | null;
    buildFile: string;
    targets: AntTarget[];
}

/**
 * Represents an Ant target with its properties.
 */
export interface AntTarget {
    name: string;
    description: string | null;
    dependencies: string[];
    ifCondition: string | null;
    unlessCondition: string | null;
    isDefault: boolean;
}

/**
 * Represents a user's Ant launch configuration.
 */
export interface AntLaunchConfiguration {
    name: string;
    buildFile: string;
    targets: string[];
    properties: { [key: string]: string };
    vmArguments: string;
    workingDirectory: string;
}
