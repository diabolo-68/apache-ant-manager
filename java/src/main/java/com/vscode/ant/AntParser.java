package com.vscode.ant;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import org.apache.tools.ant.Project;
import org.apache.tools.ant.ProjectHelper;
import org.apache.tools.ant.Target;

import java.io.File;
import java.util.*;

/**
 * Main entry point for parsing Apache Ant build files.
 * Outputs target information as JSON to stdout.
 */
public class AntParser {

    public static void main(String[] args) {
        if (args.length < 1) {
            System.err.println("Usage: java -jar ant-parser.jar <build.xml path>");
            System.exit(1);
        }

        String buildFilePath = args[0];
        File buildFile = new File(buildFilePath);

        if (!buildFile.exists()) {
            System.err.println("Build file not found: " + buildFilePath);
            System.exit(1);
        }

        try {
            AntBuildInfo buildInfo = parseBuildFile(buildFile);
            Gson gson = new GsonBuilder().setPrettyPrinting().create();
            System.out.println(gson.toJson(buildInfo));
        } catch (Exception e) {
            System.err.println("Error parsing build file: " + e.getMessage());
            System.exit(1);
        }
    }

    /**
     * Parse an Ant build file and extract target information.
     */
    public static AntBuildInfo parseBuildFile(File buildFile) {
        // Capture stdout/stderr to prevent Ant logging from corrupting our JSON output
        java.io.PrintStream originalOut = System.out;
        java.io.PrintStream originalErr = System.err;
        java.io.ByteArrayOutputStream capturedOut = new java.io.ByteArrayOutputStream();
        java.io.ByteArrayOutputStream capturedErr = new java.io.ByteArrayOutputStream();
        
        try {
            // Redirect stdout/stderr during Ant parsing
            System.setOut(new java.io.PrintStream(capturedOut));
            System.setErr(new java.io.PrintStream(capturedErr));
            
            Project project = new Project();
            
            // Add a silent build listener to suppress all Ant output
            project.addBuildListener(new org.apache.tools.ant.BuildListener() {
                @Override
                public void messageLogged(org.apache.tools.ant.BuildEvent event) {}
                @Override
                public void buildStarted(org.apache.tools.ant.BuildEvent event) {}
                @Override
                public void buildFinished(org.apache.tools.ant.BuildEvent event) {}
                @Override
                public void targetStarted(org.apache.tools.ant.BuildEvent event) {}
                @Override
                public void targetFinished(org.apache.tools.ant.BuildEvent event) {}
                @Override
                public void taskStarted(org.apache.tools.ant.BuildEvent event) {}
                @Override
                public void taskFinished(org.apache.tools.ant.BuildEvent event) {}
            });
            
            project.init();
            project.setUserProperty("ant.file", buildFile.getAbsolutePath());
            
            // Set ant.home from ANT_HOME environment variable if available
            String antHome = System.getenv("ANT_HOME");
            if (antHome != null && !antHome.isEmpty()) {
                project.setUserProperty("ant.home", antHome);
            }
            
            // Set basedir to build file's parent to avoid validation errors
            // when the build.xml references a basedir that doesn't exist
            project.setBasedir(buildFile.getParentFile().getAbsolutePath());
        
            ProjectHelper helper = ProjectHelper.getProjectHelper();
            project.addReference("ant.projectHelper", helper);
            helper.parse(project, buildFile);

            AntBuildInfo buildInfo = new AntBuildInfo();
            buildInfo.setProjectName(project.getName());
            buildInfo.setDefaultTarget(project.getDefaultTarget());
            buildInfo.setBaseDir(project.getBaseDir().getAbsolutePath());
            buildInfo.setDescription(project.getDescription());
            buildInfo.setBuildFile(buildFile.getAbsolutePath());

            List<AntTarget> targets = new ArrayList<>();
            @SuppressWarnings("unchecked")
            Hashtable<String, Target> projectTargets = project.getTargets();

            for (Map.Entry<String, Target> entry : projectTargets.entrySet()) {
                Target target = entry.getValue();
                String targetName = target.getName();
                
                // Skip empty target name (represents implicit target)
                if (targetName == null || targetName.isEmpty()) {
                    continue;
                }

                AntTarget antTarget = new AntTarget();
                antTarget.setName(targetName);
                antTarget.setDescription(target.getDescription());
                antTarget.setIfCondition(target.getIf());
                antTarget.setUnlessCondition(target.getUnless());

                // Get dependencies
                Enumeration<String> deps = target.getDependencies();
                List<String> dependencies = new ArrayList<>();
                while (deps.hasMoreElements()) {
                    dependencies.add(deps.nextElement());
                }
                antTarget.setDependencies(dependencies);

                // Check if it's the default target
                antTarget.setDefault(targetName.equals(project.getDefaultTarget()));

                targets.add(antTarget);
            }

            // Sort targets alphabetically
            targets.sort(Comparator.comparing(AntTarget::getName));
            buildInfo.setTargets(targets);

            return buildInfo;
        } finally {
            // Restore original stdout/stderr
            System.setOut(originalOut);
            System.setErr(originalErr);
        }
    }
}
