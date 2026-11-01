// Recorded responses for the built-in samples: used only when the live API is unreachable
// or out of credits, and always labelled "recorded" in the UI.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "samples");
const SAMPLES = ["brightcart", "northwind", "launchpad"];

export function recordedFor(kind, text) {
  for (const name of SAMPLES) {
    try {
      const src = readFileSync(join(dir, `${name}.txt`), "utf8");
      if (src.trim() === text.trim()) {
        const file = kind === "redact" ? `${name}.redact.json` : `${name}.analysis.json`;
        return JSON.parse(readFileSync(join(dir, file), "utf8"));
      }
    } catch { /* sample missing */ }
  }
  return null;
}
