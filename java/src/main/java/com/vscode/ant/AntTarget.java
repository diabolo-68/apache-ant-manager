package com.vscode.ant;

import java.util.List;

/**
 * Represents an Ant target with its properties.
 */
public class AntTarget {
    private String name;
    private String description;
    private List<String> dependencies;
    private String ifCondition;
    private String unlessCondition;
    private boolean isDefault;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public List<String> getDependencies() {
        return dependencies;
    }

    public void setDependencies(List<String> dependencies) {
        this.dependencies = dependencies;
    }

    public String getIfCondition() {
        return ifCondition;
    }

    public void setIfCondition(String ifCondition) {
        this.ifCondition = ifCondition;
    }

    public String getUnlessCondition() {
        return unlessCondition;
    }

    public void setUnlessCondition(String unlessCondition) {
        this.unlessCondition = unlessCondition;
    }

    public boolean isDefault() {
        return isDefault;
    }

    public void setDefault(boolean isDefault) {
        this.isDefault = isDefault;
    }
}
