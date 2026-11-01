// Local server: serves public/ and the same /api handlers Vercel runs.
//   CLOCKED_API_KEY=clk_live_... node server.js   ->  http://localhost:3000
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import analyze from "./api/analyze.js";
import redact from "./api/redact.js";
import verify from "./api/verify.js";

const routes = { "/api/analyze": analyze, "/api/redact": redact, "/api/verify": verify };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
const PORT = Number(process.env.PORT || 3000);

function shim(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); return res; };
  return res;
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const handler = routes[url.pathname];
  if (handler) return handler(req, shim(res));
  const path = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
  try {
    const body = await readFile(join(process.cwd(), "public", path));
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
}).listen(PORT, () => console.log(`OfferLens on http://localhost:${PORT}`));
