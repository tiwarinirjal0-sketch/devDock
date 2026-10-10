
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectProject } from "../src/services/projectDetector.js";
import { runBuild } from "../src/services/buildRunner.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectPath = path.join(
  currentDir,
  "fixtures",
  "runner-app"
);

// Step 1: Detect the sample project's configuration.
const config = await detectProject(projectPath);

assert.equal(config.runtime, "node");

console.log("Detected project:", config);

// Step 2: Run its installation and build steps.
const result = await runBuild(projectPath, config);

for (const step of result.steps) {
  console.log(`\nStage: ${step.stage}`);
  console.log(step.output);
  console.log("Exit code:", step.exitCode);
}

// Step 3: Verify the overall result.
assert.equal(
  result.success,
  true,
  JSON.stringify(result, null, 2)
);

console.log("\nPASS: Build runner completed successfully!");