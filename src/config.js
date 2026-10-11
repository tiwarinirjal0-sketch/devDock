/**
 * Central configuration.
 *
 * Every tunable is an environment variable so the same build runs unchanged in
 * development, CI and production. Defaults are safe for local use; production
 * mode (NODE_ENV=production) refuses to start with an insecure setup.
 * See .env.example for the full list with explanations.
 */
import path from "node:path";

const env = process.env;
const MB = 1024 * 1024;

function int(name, fallback) {
  const n = Number.parseInt(env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseTrustProxy(value) {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

const nodeEnv = env.NODE_ENV || "development";
const isProd = nodeEnv === "production";
const port = int("PORT", 3000);
const dataDir = path.resolve(env.DATA_DIR || "./data");

export const config = {
  nodeEnv,
  isProd,
  host: env.HOST || "0.0.0.0",
  port,
  trustProxy: parseTrustProxy(env.TRUST_PROXY),

  // Public addressing: apps live at <slug>.<baseDomain>, the API at <baseDomain>.
  baseDomain: (env.BASE_DOMAIN || "localhost").toLowerCase(),
  publicScheme: env.PUBLIC_SCHEME || (isProd ? "https" : "http"),
  publicPort: env.PUBLIC_PORT ?? (isProd ? "" : String(port)),

  // Each key is one tenant. Parsed once; never logged.
  apiKeys: (env.API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean),

  // Storage layout under DATA_DIR.
  dataDir,
  appsDir: path.join(dataDir, "apps"), // one folder per deployment
  logsDir: path.join(dataDir, "logs"), // build.log / runtime.log per deployment
  tmpDir: path.join(dataDir, "tmp"), // in-flight uploads
  cacheDir: path.join(dataDir, "cache"), // shared package-manager caches
  stateFile: path.join(dataDir, "deployments.json"),

  // Upload / abuse limits.
  maxUploadBytes: int("MAX_UPLOAD_MB", 100) * MB,
  maxUnzippedBytes: int("MAX_UNZIPPED_MB", 500) * MB,
  maxZipEntries: int("MAX_ZIP_ENTRIES", 20000),
  maxDeploymentsPerOwner: int("MAX_DEPLOYMENTS_PER_OWNER", 20),
  rateLimitPerMin: int("RATE_LIMIT_PER_MIN", 120),
  uploadLimitPerMin: int("UPLOAD_LIMIT_PER_MIN", 10),

  // Build pipeline.
  buildTimeoutMs: int("BUILD_TIMEOUT_SEC", 600) * 1000,
  buildConcurrency: Math.max(1, int("BUILD_CONCURRENCY", 2)),
  maxQueuedBuilds: int("MAX_QUEUED_BUILDS", 20),
  healthTimeoutMs: int("HEALTH_TIMEOUT_SEC", 60) * 1000,
  maxCrashRestarts: int("MAX_CRASH_RESTARTS", 5),
  maxLogBytes: int("MAX_LOG_KB", 1024) * 1024,

  // Loopback port pool for hosted apps.
  portStart: int("APP_PORT_START", 4000),
  portEnd: int("APP_PORT_END", 4999),

  // Isolation.
  sandbox: env.SANDBOX || "none", // "none" | "docker"
  nodeImage: env.NODE_IMAGE || "node:22-slim",
  pythonImage: env.PYTHON_IMAGE || "python:3.12-slim",
  appMemoryMb: int("APP_MEMORY_MB", 512),
  appCpus: Number(env.APP_CPUS) > 0 ? Number(env.APP_CPUS) : 1,
  appPidsLimit: int("APP_PIDS_LIMIT", 256),
  buildMemoryMb: int("BUILD_MEMORY_MB", 2048),
  buildCpus: Number(env.BUILD_CPUS) > 0 ? Number(env.BUILD_CPUS) : 2,
};

/** Absolute folder holding the files of one deployment. */
export function appDir(id) {
  return path.join(config.appsDir, id);
}

/** Public URL a deployment is (or will be) reachable at. */
export function publicUrl(slug) {
  const port = config.publicPort ? `:${config.publicPort}` : "";
  return `${config.publicScheme}://${slug}.${config.baseDomain}${port}`;
}

/** Fail fast on a configuration that would be unsafe or broken. */
export function validateConfig() {
  const problems = [];

  if (!["none", "docker"].includes(config.sandbox)) {
    problems.push("SANDBOX must be 'none' or 'docker'");
  }
  if (config.portStart > config.portEnd) {
    problems.push("APP_PORT_START must be <= APP_PORT_END");
  }
  if (config.isProd) {
    if (config.apiKeys.length === 0) {
      problems.push("API_KEYS must be set in production");
    }
    if (config.apiKeys.some((k) => k.length < 24)) {
      problems.push("Every API key must be >= 24 characters (try: openssl rand -hex 24)");
    }
    if (config.baseDomain === "localhost") {
      problems.push("BASE_DOMAIN must be set in production (e.g. apps.example.com)");
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
  }
}