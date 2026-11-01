// Small, best-effort protections for a public demo that spends one shared credit pool.
import { createHash } from "node:crypto";

const hits = new Map(); // ip -> [timestamps]
const cache = new Map(); // sha256(kind+text) -> result
const LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR || 20);

export function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  return (Array.isArray(xf) ? xf[0] : xf || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

export function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= LIMIT) return true;
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

export const hashKey = (kind, text) => createHash("sha256").update(kind + "\u0000" + text).digest("hex");
export const cacheGet = (k) => cache.get(k);
export function cacheSet(k, v) {
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(k, v);
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
