/**
 * Minimal structured logger: JSON lines in production (easy to ship to any log
 * aggregator), readable text in development. Level via LOG_LEVEL.
 */
import { config } from "./config.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL ?? "info"] ?? LEVELS.info;

function normalize(meta) {
  if (!meta) return {};
  const out = { ...meta };
  if (out.err instanceof Error) out.err = out.err.stack || out.err.message;
  return out;
}

function emit(level, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const data = normalize(meta);
  const time = new Date().toISOString();
  const line = config.isProd
    ? JSON.stringify({ time, level, msg, ...data })
    : `${time} ${level.toUpperCase().padEnd(5)} ${msg}${
        Object.keys(data).length ? " " + JSON.stringify(data) : ""
      }`;
  (LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout).write(line + "\n");
}

export const log = {
  debug: (msg, meta) => emit("debug", msg, meta),
  info: (msg, meta) => emit("info", msg, meta),
  warn: (msg, meta) => emit("warn", msg, meta),
  error: (msg, meta) => emit("error", msg, meta),
};