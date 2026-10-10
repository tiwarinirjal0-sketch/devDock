
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectProject } from "../src/services/projectDetector.js";

// Find the fixtures directory relative to this test file.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(currentDir, "fixtures");

// Define what the detector should identify in each sample.
const testCases = [
  {
    name: "Express app",
    folder: "express-app",
    runtime: "node",
    framework: "express",
  },
  {
    name: "FastAPI app",
    folder: "python-app",
    runtime: "python",
    framework: "fastapi",
  },
  {
    name: "Static HTML app",
    folder: "static-app",
    runtime: "static",
    framework: "html",
  },
];

// Inspect each sample and compare the actual result with expectations.
for (const testCase of testCases) {
  const projectPath = path.join(fixturesDir, testCase.folder);

  const result = await detectProject(projectPath);

  // Fail immediately if either value differs from the expected value.
  assert.equal(result.runtime, testCase.runtime);
  assert.equal(result.framework, testCase.framework);

  console.log(`PASS: ${testCase.name}`);
  console.log(result);
}

console.log("All detector tests passed!");