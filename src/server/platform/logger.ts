/**
 * Structured logger. Single-line JSON in production, readable lines in development.
 * Adds the current correlation context (requestId / jobId) to every entry.
 * Secrets are redacted and personal data (email, phone) is masked — never pass card data.
 */
import { currentContext } from "@/server/platform/context";

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEYS =
  /pass(word)?|secret|token|signature|authorization|cookie|card|cvv|x-api-key|apikey/i;
const MASK_KEYS = /email|phone|mobile|contact/i;

function mask(v: unknown): unknown {
  if (typeof v !== "string") return v;
  if (v.includes("@")) {
    const [local = "", domain = ""] = v.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return v.length > 4 ? `${"*".repeat(v.length - 4)}${v.slice(-4)}` : "****";
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT_KEYS.test(k)
      ? "[redacted]"
      : MASK_KEYS.test(k)
        ? mask(v)
        : redact(v, depth + 1);
  }
  return out;
}

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  return order[lvl] ?? order.info;
}

function emit(level: Level, msg: string, ctx?: Record<string, unknown>) {
  if (order[level] < threshold()) return;
  if (process.env.NODE_ENV === "test" && level !== "error" && !process.env.LOG_IN_TESTS) return;
  const exec = currentContext();
  const fields = {
    ...(exec
      ? {
          requestId: exec.requestId,
          ...(exec.jobId ? { jobId: exec.jobId, jobType: exec.jobType } : {}),
        }
      : {}),
    ...(redact(ctx ?? {}) as object),
  };
  const line =
    process.env.NODE_ENV === "production"
      ? JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields })
      : `[${level}] ${msg}${Object.keys(fields).length ? " " + JSON.stringify(fields) : ""}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
};
