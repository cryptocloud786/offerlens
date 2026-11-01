// Re-check an edited email draft against the offer before the candidate sends it.
import { runVerify } from "../lib/offerlens.js";
import { clientIp, rateLimited, readJson } from "../lib/guard.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  let body;
  try { body = await readJson(req); } catch { return res.status(400).json({ error: "Body must be JSON" }); }
  const text = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n") : "";
  const draft = typeof body.draft === "string" ? body.draft : "";
  if (!text.trim() || !draft.trim()) return res.status(400).json({ error: "Need the offer text and a draft." });
  if (text.length > 20000 || draft.length > 6000) return res.status(413).json({ error: "Too long for the demo." });
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "Demo rate limit reached. Try again later." });
  try {
    const v = await runVerify(text, "", draft);
    return res.status(200).json({ verify: v.data, usage: [v.meta], credits: v.meta.credits });
  } catch (e) {
    return res.status(503).json({ error: `Clocked grounding request failed: ${e.message}` });
  }
}
