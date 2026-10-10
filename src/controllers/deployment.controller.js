import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import extract from "extract-zip";
import { detectProject } from "../services/projectDetector.js";
import { runBuild } from "../services/buildRunner.js";

// Where each upload gets unzipped. One fresh folder per request.
const WORK_DIR = path.join(os.tmpdir(), "deployments");

export async function createDeployment(req, res) {
  let workDir;

  try {
    // 1. Validate the request. Multer already saved the file and filled req.file.
    if (!req.file) {
      return res.status(400).json({
        error: "Upload a .zip file in the form field 'project'",
      });
    }

    // 2. Extract into a folder whose name we generate ourselves.
    //    The client's filename is never used to build a path.
    const id = randomUUID();
    workDir = path.join(WORK_DIR, id);
    await extract(req.file.path, { dir: workDir });

    // 3. If the zip holds one top-level folder, build from inside it.
    //    Ignore __MACOSX, which macOS adds to zips.
    const entries = (await fs.readdir(workDir, { withFileTypes: true }))
      .filter((e) => e.name !== "__MACOSX");

    const projectPath =
      entries.length === 1 && entries[0].isDirectory()
        ? path.join(workDir, entries[0].name)
        : workDir;

    // 4. Detect
    const detected = await detectProject(projectPath);

    if (detected.error || detected.runtime === "unknown") {
      return res.status(422).json({
        id,
        status: "failed",
        stage: "detection",
        detected,
      });
    }

    // 5. Build
    const build = await runBuild(projectPath, detected);

    // 6. Respond. The request worked, so the build result goes in the body.
    return res.status(200).json({
      id,
      project: req.file.originalname, // display only
      status: build.success ? "success" : "failed",
      detected,
      build,
    });
  } catch (err) {
    // A bad or corrupt zip also lands here.
    console.error("Deployment error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    // Always remove the uploaded zip and the extracted folder.
    if (req.file) await fs.rm(req.file.path, { force: true });
    if (workDir) await fs.rm(workDir, { recursive: true, force: true });
  }
}