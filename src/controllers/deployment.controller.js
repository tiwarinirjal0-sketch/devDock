import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectProject } from "../services/projectDetector.js";
import { runBuild } from "../services/buildRunner.js";

// Build the absolute path to tests/fixtures, no matter where the server starts from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.resolve(__dirname, "../../tests/fixtures");

// The client can only pick from this list. It never sends a path.
const ALLOWED_PROJECTS = ["express-app", "runner-app", "python-app", "static-app"];

export async function createDeployment(req, res) {
  try {
    // 1. Validate the request
    const { project } = req.body ?? {};

    if (typeof project !== "string" || !ALLOWED_PROJECTS.includes(project)) {
      return res.status(400).json({
        error: "Unknown project",
        allowed: ALLOWED_PROJECTS,
      });
    }

    // 2. We build the real path ourselves from a name we trust
    const projectPath = path.join(PROJECTS_DIR, project);

    // 3. Detect
    const detected = await detectProject(projectPath);

    if (detected.error || detected.runtime === "unknown") {
      return res.status(422).json({
        project,
        status: "failed",
        stage: "detection",
        detected,
      });
    }

    // 4. Build
    const build = await runBuild(projectPath, detected);

    // 5. Respond. The request worked, so the build result goes in the body.
    return res.status(200).json({
      project,
      status: build.success ? "success" : "failed",
      detected,
      build,
    });
  } catch (err) {
    // Anything unexpected lands here instead of crashing the server.
    console.error("Deployment error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}