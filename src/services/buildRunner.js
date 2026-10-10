
import { spawn } from "node:child_process";
import path from "node:path";

/*
 * Run one process inside the specified project directory.
 *
 * command: executable, such as "npm"
 * args:    arguments, such as ["ci"]
 * cwd:     project directory
 *
 * We use shell: false so the command isn't interpreted by a shell.
 * This does NOT make untrusted builds safe: npm scripts can still
 * execute arbitrary code. Use only trusted projects locally for now.
 */
function runProcess(command, args, cwd, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    // Collect stdout and stderr so the caller can inspect build logs.
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    // Prevent a build from running forever.
    const timer = setTimeout(() => {
      child.kill("SIGTERM");

      finish({
        success: false,
        exitCode: null,
        output,
        error: "Process timed out",
      });
    }, timeoutMs);

    // Report the exit status when the process finishes.
    child.on("close", (code, signal) => {
      finish({
        success: code === 0,
        exitCode: code,
        signal,
        output,
        error: code === 0 ? null : `Process exited with code ${code}`,
      });
    });

    // Handle failures such as an executable not being installed.
    child.on("error", (error) => {
      finish({
        success: false,
        exitCode: null,
        output,
        error: error.message,
      });
    });
  });
}

/*
 * Convert a detector result into the initial Node.js build workflow.
 *
 * This version supports npm projects only. Other package managers
 * can be added later using explicit executable/argument mappings.
 */
export async function runBuild(projectPath, config) {
  const cwd = path.resolve(projectPath);

  if (config.runtime !== "node") {
    return {
      success: false,
      stage: "validation",
      error: `Unsupported runtime: ${config.runtime}`,
      steps: [],
    };
  }

  if (config.packageManager !== "npm") {
    return {
      success: false,
      stage: "validation",
      error: `Unsupported package manager: ${config.packageManager}`,
      steps: [],
    };
  }

  const steps = [];

  // Use an explicit allowlist instead of executing a command string
  // supplied by a project configuration.
  const installArgs = {
    "npm ci": ["ci"],
    "npm install": ["install"],
  }[config.installCommand];

  if (!installArgs) {
    return {
      success: false,
      stage: "validation",
      error: "Unsupported install command",
      steps,
    };
  }

  // Stage 1: Install dependencies.
  const install = await runProcess("npm", installArgs, cwd);

  steps.push({
    stage: "install",
    ...install,
  });

  // Don't try to build when installation has failed.
  if (!install.success) {
    return {
      success: false,
      stage: "install",
      steps,
    };
  }

  // Stage 2: Build the application, if a build script exists.
  if (config.buildCommand !== null) {
    if (config.buildCommand !== "npm run build") {
      return {
        success: false,
        stage: "validation",
        error: "Unsupported build command",
        steps,
      };
    }

    const build = await runProcess(
      "npm",
      ["run", "build"],
      cwd
    );

    steps.push({
      stage: "build",
      ...build,
    });

    if (!build.success) {
      return {
        success: false,
        stage: "build",
        steps,
      };
    }
  }

  // Both stages succeeded, or there was no build script to run.
  return {
    success: true,
    stage: "complete",
    steps,
  };
}