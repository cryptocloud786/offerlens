import { analyse, MAX_CHARS } from "../lib/offerlens.js";
import { clientIp, rateLimited, hashKey, cacheGet, cacheSet, readJson } from "../lib/guard.js";
import { recordedFor } from "../lib/recorded.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  let body;
  try { body = await readJson(req); } catch { return res.status(400).json({ error: "Body must be JSON" }); }
  const text = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n") : "";
  if (text.trim().length < 80) return res.status(400).json({ error: "Paste the full offer letter (at least a few sentences)." });
  if (text.length > MAX_CHARS) return res.status(413).json({ error: `Offer is too long for the demo (max ${MAX_CHARS.toLocaleString()} characters).` });

  const key = hashKey("analyse", text);
  const cached = cacheGet(key);
  if (cached) return res.status(200).json({ ...cached, cached: true });

  if (rateLimited(clientIp(req))) {
    const rec = recordedFor("analyse", text);
    if (rec) return res.status(200).json({ ...rec, recorded: true, notice: "Demo rate limit reached: showing a recorded result." });
    return res.status(429).json({ error: "Demo rate limit reached. Try again in an hour, or run OfferLens locally with your own key." });
  }

  try {
    const result = await analyse(text);
    cacheSet(key, result);
    return res.status(200).json(result);
  } catch (e) {
    const rec = recordedFor("analyse", text);
    if (rec) return res.status(200).json({ ...rec, recorded: true, notice: `Live analysis failed (${e.message}); showing a recorded result.` });
    const status = e.status === 402 ? 503 : e.status && e.status < 500 ? 502 : 503;
    return res.status(status).json({ error: `Clocked ${e.endpoint || ""} request failed: ${e.message}`, step: e.endpoint || null });
  }
}
