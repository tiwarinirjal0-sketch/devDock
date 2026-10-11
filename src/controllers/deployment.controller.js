import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import extract from "extract-zip";
import { appDir, publicUrl } from "../config.js";
import { log } from "../logger.js";
import { PipelineError } from "../lib/errors.js";
import { detectProject } from "../services/projectDetector.js";
import { runBuild } from "../services/buildRunner.js";
import { startApp } from "../services/projectStarter.js";

export async function createDeployment(req, res) {
  let deployDir;
  let keepFiles = false;

  try {
    // 1. Validate the request.
    if (!req.file) {
      return res.status(400).json({
        error: "Upload a .zip file in the form field 'project'",
      });
    }

    // Optional env vars for the deployed app, sent as a JSON string in the 'env' field.
    let env = {};
    if (req.body?.env) {
      try {
        env = JSON.parse(req.body.env);
        if (typeof env !== "object" || env === null || Array.isArray(env)) {
          throw new Error("env must be a JSON object");
        }
      } catch {
        return res.status(400).json({
          error: "Field 'env' must be a JSON object, e.g. {\"KEY\":\"value\"}",
        });
      }
    }

    // 2. Extract.
    const id = randomUUID();
    deployDir = appDir(id);
    await extract(req.file.path, { dir: deployDir });

    // 3. Find the project root (single top-level folder, ignoring __MACOSX).
    const entries = (await fs.readdir(deployDir, { withFileTypes: true }))
      .filter((e) => e.name !== "__MACOSX");

    const projectPath =
      entries.length === 1 && entries[0].isDirectory()
        ? path.join(deployDir, entries[0].name)
        : deployDir;

    // 4. Detect.
    const detected = await detectProject(projectPath);

    if (detected.error || detected.runtime === "unknown") {
      return res.status(422).json({ id, status: "failed", stage: "detection", detected });
    }

    // 5. Build.
    const build = await runBuild(projectPath, detected);

    if (!build.success) {
      return res.status(200).json({
        id,
        project: req.file.originalname,
        status: "failed",
        stage: "build",
        detected,
        build,
      });
    }

    // 6. Start. Static sites have no process.
    if (detected.runtime === "static") {
      keepFiles = true;
      return res.status(201).json({
        id,
        project: req.file.originalname,
        status: "running",
        url: publicUrl(id.slice(0, 8)),
        detected,
        build,
      });
    }

    if (!detected.startCommand) {
      return res.status(422).json({
        id,
        status: "failed",
        stage: "detection",
        error: "No start command detected for this project",
        detected,
      });
    }

    // startApp expects { command, args }: "npm start" -> { command: "npm", args: ["start"] }
    const [command, ...args] = detected.startCommand.trim().split(/\s+/);

    let started;
    try {
      started = await startApp({
        id,
        projectPath,
        start: { command, args },
        env, // merged into the child's environment by buildEnv()
      });
    } catch (err) {
      if (err instanceof PipelineError) {
        return res.status(200).json({
          id,
          project: req.file.originalname,
          status: "failed",
          stage: err.stage,
          error: err.message,
          detected,
          build,
        });
      }
      throw err;
    }

    keepFiles = true;
    log.info("deployment running", { id, port: started.port });

    // 7. Respond.
    return res.status(201).json({
      id,
      project: req.file.originalname,
      status: "running",
      url: publicUrl(id.slice(0, 8)),
      detected,
      build,
    });
  } catch (err) {
    log.error("deployment error", { err });
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    if (req.file) await fs.rm(req.file.path, { force: true });
    if (deployDir && !keepFiles) {
      await fs.rm(deployDir, { recursive: true, force: true });
    }
  }
}