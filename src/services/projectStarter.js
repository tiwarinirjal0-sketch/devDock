/**
 * Runner service: starts a built project as a managed child process and keeps it alive.
 *
 * Lifecycle of one app:
 *   1. allocate a free loopback port from the pool (APP_PORT_START..APP_PORT_END)
 *   2. spawn the start command with PORT/HOST injected and a minimal, clean env
 *   3. wait until the app is actually accepting TCP connections (health gate)
 *   4. on unexpected exit, restart with exponential backoff, up to MAX_CRASH_RESTARTS
 *   5. stop = kill the whole process group, free the port
 *
 * Contract with the detector: `start` is { command: string, args: string[] },
 * e.g. { command: "npm", args: ["start"] } or { command: "python3", args: ["app.py"] }.
 *
 * Only SANDBOX=none is implemented here (plain child processes, trusted clients only).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { config } from "../config.js";
import { log } from "../logger.js";
import { PipelineError } from "../lib/errors.js";

/** id -> { child, port, state, restarts, stopping, startedAt, spec } */
const apps = new Map();
const usedPorts = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- ports ----------------------------- */

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function allocatePort() {
  for (let p = config.portStart; p <= config.portEnd; p++) {
    if (usedPorts.has(p)) continue;
    if (await isPortFree(p)) {
      usedPorts.add(p);
      return p;
    }
  }
  throw new PipelineError("start", "No free ports available; try again later");
}

/* ----------------------------- logs ------------------------------ */

/** Append-only log file that stops growing at MAX_LOG_KB so a chatty app can't fill the disk. */
function openCappedLog(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stream = fs.createWriteStream(file, { flags: "a" });
  let written = fs.existsSync(file) ? fs.statSync(file).size : 0;
  let truncated = false;
  return {
    write(chunk) {
      if (written >= config.maxLogBytes) {
        if (!truncated) {
          truncated = true;
          stream.write("\n[log truncated: size limit reached]\n");
        }
        return;
      }
      written += chunk.length;
      stream.write(chunk);
    },
    close: () => stream.end(),
  };
}

/* ---------------------------- health ----------------------------- */

function canConnect(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });
}

async function waitUntilListening(port, child) {
  const deadline = Date.now() + config.healthTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new PipelineError(
        "start",
        `App exited (code ${child.exitCode ?? child.signalCode}) before it started listening. Check runtime logs.`,
      );
    }
    if (await canConnect(port)) return;
    await sleep(250);
  }
  throw new PipelineError(
    "start",
    `App did not listen on the injected PORT within ${config.healthTimeoutMs / 1000}s. ` +
      "Make sure it reads process.env.PORT and binds to HOST.",
  );
}

/* ---------------------------- spawning --------------------------- */

/** Minimal env: never leak the platform's own secrets (API_KEYS etc.) into tenant code. */
function buildEnv(cwd, port, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: cwd,
    NODE_ENV: "production",
    ...extra,
    PORT: String(port),
    HOST: "127.0.0.1",
  };
}

function spawnApp(entry, logger) {
  const { spec, port } = entry;
  const child = spawn(spec.start.command, spec.start.args ?? [], {
    cwd: spec.projectPath,
    env: buildEnv(spec.projectPath, port, spec.env),
    detached: true, // own process group, so stop() can kill npm *and* its children
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => logger.write(d));
  child.stderr.on("data", (d) => logger.write(d));
  child.once("error", (err) => logger.write(`[spawn error] ${err.message}\n`));
  entry.child = child;
  entry.startedAt = Date.now();
  return child;
}

/* ---------------------------- public API ------------------------- */

/**
 * Start an app and resolve once it is accepting connections.
 * @param {{id:string, projectPath:string, start:{command:string,args?:string[]}, env?:object}} spec
 * @returns {Promise<{port:number, pid:number}>}
 */
export async function startApp(spec) {
  if (config.sandbox !== "none") {
    throw new PipelineError("start", `SANDBOX=${config.sandbox} is not implemented in the runner yet`);
  }
  if (apps.has(spec.id)) await stopApp(spec.id);

  const port = await allocatePort();
  const logger = openCappedLog(path.join(config.logsDir, spec.id, "runtime.log"));
  const entry = { spec, port, state: "starting", restarts: 0, stopping: false, logger };
  apps.set(spec.id, entry);

  try {
    const child = spawnApp(entry, logger);
    watchForCrash(entry);
    await waitUntilListening(port, child);
    entry.state = "running";
    log.info("app started", { id: spec.id, port, pid: child.pid });
    return { port, pid: child.pid };
  } catch (err) {
    await stopApp(spec.id);
    throw err;
  }
}

/** Restart-on-crash with exponential backoff (1s, 2s, 4s ... capped at 30s). */
function watchForCrash(entry) {
  const child = entry.child;
  child.once("exit", async (code, signal) => {
    if (entry.stopping) return;
    const { id } = entry.spec;
    if (entry.state === "starting") return; // startApp() reports this failure itself

    if (entry.restarts >= config.maxCrashRestarts) {
      entry.state = "crashed";
      log.error("app crashed too many times, giving up", { id, code, signal });
      freePort(entry);
      return;
    }
    entry.restarts += 1;
    entry.state = "restarting";
    const delay = Math.min(1000 * 2 ** (entry.restarts - 1), 30_000);
    log.warn("app exited, restarting", { id, code, signal, attempt: entry.restarts, delayMs: delay });
    await sleep(delay);
    if (entry.stopping) return;

    const next = spawnApp(entry, entry.logger);
    watchForCrash(entry);
    try {
      await waitUntilListening(entry.port, next);
      entry.state = "running";
    } catch {
      /* the exit handler on `next` drives the next retry */
    }
  });
}

function freePort(entry) {
  usedPorts.delete(entry.port);
}

/** Stop an app: SIGTERM the process group, SIGKILL after 5s, release the port. */
export async function stopApp(id) {
  const entry = apps.get(id);
  if (!entry) return;
  entry.stopping = true;
  entry.state = "stopped";
  const child = entry.child;

  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((r) => child.once("exit", r));
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
    const timedOut = await Promise.race([exited.then(() => false), sleep(5000).then(() => true)]);
    if (timedOut) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    }
  }
  entry.logger?.close();
  freePort(entry);
  apps.delete(id);
  log.info("app stopped", { id });
}

/** Port a deployment is listening on (used by the reverse proxy), or null. */
export function getPort(id) {
  const e = apps.get(id);
  return e && (e.state === "running" || e.state === "restarting") ? e.port : null;
}

export function getStatus(id) {
  const e = apps.get(id);
  if (!e) return { state: "stopped" };
  return {
    state: e.state,
    port: e.port,
    pid: e.child?.pid,
    restarts: e.restarts,
    uptimeSec: e.state === "running" ? Math.round((Date.now() - e.startedAt) / 1000) : 0,
  };
}

/** Called on shutdown (SIGTERM/SIGINT) so no orphaned apps keep running. */
export async function stopAll() {
  await Promise.all([...apps.keys()].map(stopApp));
}
// export function getPortBySlug(slug) {
//   for (const [id, entry] of apps.entries()) {
//     if (
//       id.startsWith(slug) &&
//       (entry.state === "running" || entry.state === "restarting")
//     ) {
//       return entry.port;
//     }
//   }

//   return null;
// }