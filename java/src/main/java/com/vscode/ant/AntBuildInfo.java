package com.vscode.ant;

import java.util.List;

/**
 * Represents the parsed information from an Ant build file.
 */
public class AntBuildInfo {
    private String projectName;
    private String defaultTarget;
    private String baseDir;
    private String description;
    private String buildFile;
    private List<AntTarget> targets;

    public String getProjectName() {
        return projectName;
    }

    public void setProjectName(String projectName) {
        this.projectName = projectName;
    }

    public String getDefaultTarget() {
        return defaultTarget;
    }

    public void setDefaultTarget(String defaultTarget) {
        this.defaultTarget = defaultTarget;
    }

    public String getBaseDir() {
        return baseDir;
    }

    public void setBaseDir(String baseDir) {
        this.baseDir = baseDir;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getBuildFile() {
        return buildFile;
    }

    public void setBuildFile(String buildFile) {
        this.buildFile = buildFile;
    }

    public List<AntTarget> getTargets() {
        return targets;
    }

    public void setTargets(List<AntTarget> targets) {
        this.targets = targets;
    }
}
