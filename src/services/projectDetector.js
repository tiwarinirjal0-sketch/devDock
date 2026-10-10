
import fs from "node:fs/promises";
import path from "node:path";

/*
 * HELPER FUNCTIONS
 *
 * exists(path):
 * Checks whether a file or directory exists.
 * Returns true if accessible, otherwise false.
 */
const exists = (p) => fs.access(p).then(() => true, () => false);

/*
 * readText(path):
 * Reads a file as text if it exists.
 * Returns null when the file cannot be accessed.
 *
 * Example:
 * readText("package.json") -> file contents or null
 */
const readText = async (p) =>
  (await exists(p)) ? fs.readFile(p, "utf8") : null;


/*
 * NODE.JS FRAMEWORK DATABASE
 *
 * Instead of writing separate detection logic for every framework,
 * we maintain a list of recognizable dependencies.
 *
 * name:
 *   Framework name to return.
 *
 * dep:
 *   Dependency name searched for in package.json.
 *
 * kind:
 *   "web" means a server-rendered/server application.
 *   "static" means a frontend that can be published as files.
 *
 * publishDir:
 *   Directory containing built static files.
 *
 * IMPORTANT:
 * Order matters. More specific frameworks should appear before
 * the underlying tools or libraries they may also use.
 */
const NODE_FRAMEWORKS = [
  { name: "next", dep: "next", kind: "web" },
  { name: "nuxt", dep: "nuxt", kind: "web" },
  { name: "remix", dep: "@remix-run/node", kind: "web" },
  { name: "nestjs", dep: "@nestjs/core", kind: "web" },

  { name: "astro", dep: "astro", kind: "static", publishDir: "dist" },
  { name: "vite", dep: "vite", kind: "static", publishDir: "dist" },
  {
    name: "create-react-app",
    dep: "react-scripts",
    kind: "static",
    publishDir: "build",
  },

  { name: "fastify", dep: "fastify", kind: "web" },
  { name: "express", dep: "express", kind: "web" },
];


/*
 * PACKAGE MANAGER DATABASE
 *
 * Lockfiles identify which package manager a project uses.
 *
 * A lockfile also lets us choose a more reproducible install command.
 *
 * Example:
 * package-lock.json -> npm ci
 * pnpm-lock.yaml    -> pnpm install --frozen-lockfile
 */
const LOCKFILES = [
  {
    file: "pnpm-lock.yaml",
    pm: "pnpm",
    install: "pnpm install --frozen-lockfile",
  },
  {
    file: "yarn.lock",
    pm: "yarn",
    install: "yarn install --frozen-lockfile",
  },
  {
    file: "bun.lockb",
    pm: "bun",
    install: "bun install --frozen-lockfile",
  },
  {
    file: "bun.lock",
    pm: "bun",
    install: "bun install --frozen-lockfile",
  },
  {
    file: "package-lock.json",
    pm: "npm",
    install: "npm ci",
  },
];


/*
 * NODE.JS DETECTOR
 *
 * Looks for package.json, identifies a known framework,
 * selects a package manager, and derives build/start commands.
 */
async function detectNode(dir) {
  // Step 1: Locate the Node.js project configuration file.
  const pkgPath = path.join(dir, "package.json");

  // Read its contents. If it does not exist, this is not
  // a recognizable Node.js project.
  const raw = await readText(pkgPath);
  if (raw === null) return null;

  // Step 2: Parse package.json into a JavaScript object.
  let pkg;

  try {
    pkg = JSON.parse(raw);
  } catch {
    // The file exists but contains invalid JSON.
    return {
      runtime: "node",
      framework: "unknown",
      type: "web",
      error: "invalid package.json",
      detectedFrom: ["package.json"],
    };
  }

  // Step 3: Combine production and development dependencies.
  // Frameworks may be listed in either section.
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  // Step 4: Find the first recognized framework dependency.
  // Array.find() returns the first matching framework,
  // or undefined if none of the dependencies match.
  const match = NODE_FRAMEWORKS.find((f) => deps[f.dep]);

  // Step 5: Detect the package manager from its lockfile.
  // npm is our fallback when no supported lockfile is found.
  let packageManager = "npm";
  let installCommand = "npm install";

  for (const lock of LOCKFILES) {
    if (await exists(path.join(dir, lock.file))) {
      packageManager = lock.pm;
      installCommand = lock.install;
      break; // Stop after finding the first matching lockfile.
    }
  }

  // Step 6: Inspect available scripts in package.json.
  // Example: "build": "vite build"
  const scripts = pkg.scripts ?? {};

  // Construct the correct script command for the package manager.
  const run = (name) =>
    packageManager === "npm"
      ? `npm run ${name}`
      : `${packageManager} run ${name}`;

  // Only return a build command if a build script exists.
  const buildCommand = scripts.build ? run("build") : null;

  // Step 7: Determine how the application should start.
  let startCommand = scripts.start
    ? packageManager === "npm"
      ? "npm start"
      : `${packageManager} start`
    : pkg.main
      ? `node ${pkg.main}`
      : null;

  // Static projects without a start script publish their files.
  // They do not need a persistent Node.js server from this detector.
  const isStatic = match?.kind === "static" && !scripts.start;

  if (isStatic) {
    startCommand = null;
  }

  // Step 8: Detect the required Node.js version.
  // Prefer package.json engines.node, then .nvmrc.
  const nvmrc = (await readText(path.join(dir, ".nvmrc")))
    ?.trim()
    .replace(/^v/, "");

  const nodeVersion = pkg.engines?.node ?? nvmrc ?? null;

  // Step 9: Return the detected configuration.
  return {
    runtime: "node",
    framework: match?.name ?? "unknown",
    type: isStatic ? "static" : "web",
    packageManager,
    installCommand,
    buildCommand,
    startCommand,
    publishDir: isStatic ? match.publishDir : null,
    nodeVersion,
    detectedFrom: [
      "package.json",
      ...(match ? [match.dep] : []),
    ],
  };
}


/*
 * PYTHON DETECTOR
 *
 * Searches common Python dependency/configuration files.
 * Then looks for Django, FastAPI, or Flask in their contents.
 */
async function detectPython(dir) {
  // These files commonly describe Python dependencies.
  const files = ["requirements.txt", "pyproject.toml", "Pipfile"];

  const found = [];
  let text = "";

  // Read every available configuration file.
  for (const f of files) {
    const content = await readText(path.join(dir, f));

    if (content !== null) {
      found.push(f);

      // Lowercase text to make matching case-insensitive.
      text += `\n${content.toLowerCase()}`;
    }
  }

  // No recognizable Python dependency files were found.
  if (found.length === 0) return null;

  // Search for a framework name as a standalone dependency token.
  const has = (name) =>
    new RegExp(
      `(^|[\\s"'])${name}([\\s=<>~!\\[;"',]|$)`,
      "m"
    ).test(text);

  let framework = "unknown";
  let startCommand = null;

  // Select a known Python web framework.
  if (has("django")) {
    framework = "django";
    // Replace <project> with the actual Django project module.
    startCommand = "gunicorn <project>.wsgi --bind 0.0.0.0:$PORT";
  } else if (has("fastapi")) {
    framework = "fastapi";
    // Assumes main.py contains an ASGI application called app.
    startCommand = "uvicorn main:app --host 0.0.0.0 --port $PORT";
  } else if (has("flask")) {
    framework = "flask";
    // Assumes app.py exposes a Flask application called app.
    startCommand = "gunicorn app:app --bind 0.0.0.0:$PORT";
  }

  // Choose an installation command based on the available files.
  const installCommand = found.includes("requirements.txt")
    ? "pip install -r requirements.txt"
    : found.includes("Pipfile")
      ? "pipenv install --deploy"
      : "pip install .";

  // Read an optional Python version declaration.
  const pyVersion = (
    await readText(path.join(dir, ".python-version"))
  )?.trim() ?? null;

  // Return the Python project's detected configuration.
  return {
    runtime: "python",
    framework,
    type: "web",
    packageManager: "pip",
    installCommand,
    buildCommand: null,
    startCommand,
    nodeVersion: null,
    pythonVersion: pyVersion,
    detectedFrom: found,
  };
}


/*
 * GO DETECTOR
 *
 * A go.mod file identifies a Go module.
 * This basic detector downloads dependencies, builds the project,
 * and assumes the compiled executable can be run as ./app.
 */
async function detectGo(dir) {
  if (!(await exists(path.join(dir, "go.mod")))) return null;

  return {
    runtime: "go",
    framework: "unknown",
    type: "web",
    installCommand: "go mod download",
    buildCommand: "go build -o app .",
    startCommand: "./app",
    detectedFrom: ["go.mod"],
  };
}


/*
 * RUBY DETECTOR
 *
 * Gemfile identifies a Ruby project.
 * The current implementation recognizes Rails by searching for
 * its dependency declaration.
 */
async function detectRuby(dir) {
  const gemfile = await readText(path.join(dir, "Gemfile"));

  if (gemfile === null) return null;

  const rails = /gem\s+["']rails["']/.test(gemfile);

  return {
    runtime: "ruby",
    framework: rails ? "rails" : "unknown",
    type: "web",
    installCommand: "bundle install",
    buildCommand: rails
      ? "bundle exec rake assets:precompile"
      : null,
    startCommand: rails
      ? "bundle exec rails server -b 0.0.0.0 -p $PORT"
      : null,
    detectedFrom: ["Gemfile"],
  };
}


/*
 * STATIC HTML DETECTOR
 *
 * The simplest fallback: if index.html exists, treat the project
 * as static HTML that can be served without a build command.
 */
async function detectStatic(dir) {
  if (!(await exists(path.join(dir, "index.html")))) return null;

  return {
    runtime: "static",
    framework: "html",
    type: "static",
    installCommand: null,
    buildCommand: null,
    startCommand: null,
    publishDir: ".",
    detectedFrom: ["index.html"],
  };
}


/*
 * MAIN DETECTION FUNCTION
 *
 * This is the public entry point for the detector.
 *
 * projectPath:
 *   Path to the repository.
 *
 * rootDir:
 *   Optional subdirectory inside the repository.
 *   Useful for monorepos containing multiple applications.
 */
export async function detectProject(
  projectPath,
  { rootDir = "." } = {}
) {
  // Step 1: Resolve the absolute directory to inspect.
  const dir = path.resolve(projectPath, rootDir);

  // Step 2: Fail early if the requested directory is missing.
  if (!(await exists(dir))) {
    return {
      runtime: "unknown",
      framework: "unknown",
      error: `rootDir not found: ${rootDir}`,
    };
  }

  // Step 3: Docker configuration takes priority.
  // This version only recognizes Docker; it does not run Docker.
  if (await exists(path.join(dir, "Dockerfile"))) {
    return {
      runtime: "docker",
      framework: "unknown",
      type: "web",
      installCommand: null,
      buildCommand: "docker build .",
      startCommand: null,
      detectedFrom: ["Dockerfile"],
    };
  }

  // Step 4: Try detectors in order.
  // Each detector returns:
  //   - an object when it recognizes a project, or
  //   - null when it does not recognize one.
  //
  // Return immediately on the first non-null result.
  const detectors = [
    detectNode,
    detectPython,
    detectGo,
    detectRuby,
    detectStatic,
  ];

  for (const detect of detectors) {
    const result = await detect(dir);

    if (result !== null) {
      return result;
    }
  }

  // Step 5: No supported project type was recognized.
  return {
    runtime: "unknown",
    framework: "unknown",
    detectedFrom: [],
  };
}