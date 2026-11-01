import { redact } from "../lib/offerlens.js";
import { clientIp, rateLimited, hashKey, cacheGet, cacheSet, readJson } from "../lib/guard.js";
import { recordedFor } from "../lib/recorded.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  let body;
  try { body = await readJson(req); } catch { return res.status(400).json({ error: "Body must be JSON" }); }
  const text = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n") : "";
  if (!text.trim()) return res.status(400).json({ error: "Nothing to redact." });
  if (text.length > 20000) return res.status(413).json({ error: "Too long for the demo." });

  const names = Array.isArray(body.names) ? body.names.filter((n) => typeof n === "string").slice(0, 10) : [];
  const key = hashKey("redact", text + "\u0000" + names.join("|"));
  const cached = cacheGet(key);
  if (cached) return res.status(200).json({ ...cached, cached: true });
  if (rateLimited(clientIp(req))) {
    const rec = recordedFor("redact", text);
    if (rec) return res.status(200).json({ ...rec, recorded: true });
    return res.status(429).json({ error: "Demo rate limit reached. Try again later." });
  }
  try {
    const result = await redact(text, names);
    cacheSet(key, result);
    return res.status(200).json(result);
  } catch (e) {
    const rec = recordedFor("redact", text);
    if (rec) return res.status(200).json({ ...rec, recorded: true, notice: `Live redaction failed (${e.message}); showing a recorded result.` });
    return res.status(503).json({ error: `Clocked pii request failed: ${e.message}` });
  }
}
