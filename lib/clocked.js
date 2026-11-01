// Minimal Clocked client: bearer auth, idempotency keys, bounded retries.
// The API key is read from the server environment only (CLOCKED_API_KEY).
import { randomUUID } from "node:crypto";

const BASE = process.env.CLOCKED_BASE_URL || "https://clocked.rezolve.ai/clocked";

export class ClockedError extends Error {
  constructor(message, status, endpoint) {
    super(message);
    this.status = status;
    this.endpoint = endpoint;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function clocked(endpoint, body, { retries = 2, timeoutMs = 55000 } = {}) {
  const key = process.env.CLOCKED_API_KEY;
  if (!key) throw new ClockedError("CLOCKED_API_KEY is not set on the server", 500, endpoint);
  const idem = randomUUID(); // one logical request = one key, reused on retry
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(`${BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idem,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { error: text.slice(0, 300) }; }
      if (res.ok) {
        return {
          data: json,
          meta: {
            endpoint,
            credits: Number(res.headers.get("x-clocked-credits") || 0),
            modelMs: Number(res.headers.get("x-clocked-model-ms") || 0),
            roundTripMs: Date.now() - started,
          },
        };
      }
      const msg = json.error || json.message || `HTTP ${res.status}`;
      // 429, 409 (in progress) and 5xx are retryable with the same key; 4xx otherwise is final.
      if (res.status === 429 || res.status === 409 || res.status >= 500) {
        if (json.retryAsNew) throw new ClockedError(msg, res.status, endpoint);
        lastErr = new ClockedError(msg, res.status, endpoint);
        await sleep(400 * 2 ** attempt + Math.random() * 250);
        continue;
      }
      throw new ClockedError(msg, res.status, endpoint);
    } catch (e) {
      clearTimeout(t);
      if (e instanceof ClockedError && !(e.status === 429 || e.status === 409 || e.status >= 500)) throw e;
      lastErr = e instanceof ClockedError ? e : new ClockedError(e.name === "AbortError" ? "timed out" : e.message, 504, endpoint);
      if (attempt < retries) await sleep(400 * 2 ** attempt + Math.random() * 250);
    }
  }
  throw lastErr;
}
