import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path"; import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
import { analyse, redact, runVerify } from "../lib/offerlens.js";
const only = process.argv[2];
for (const name of ["brightcart","northwind","launchpad"]) {
  if (only && only!==name) continue;
  const text = readFileSync(`${root}/public/samples/${name}.txt`, "utf8");
  const a = await analyse(text); a.recorded_at = new Date().toISOString();
  writeFileSync(`${root}/public/samples/${name}.analysis.json`, JSON.stringify(a, null, 1));
  const names = a.terms.filter(t=>["manager","hr_contact"].includes(t.key)&&t.value).map(t=>t.value); const r = await redact(text, names); r.recorded_at = a.recorded_at;
  writeFileSync(`${root}/public/samples/${name}.redact.json`, JSON.stringify(r, null, 1));
  console.log(name, a.credits, r.credits, JSON.stringify(r.counts), a.errors.length);
}
if (!only) {
  const text = readFileSync(`${root}/public/samples/brightcart.txt`, "utf8");
  const v = await runVerify(text, "", "Dear Neha,\n\nThanks for the offer. Since my fixed salary is INR 26,00,000 and the notice period is 30 days, I am happy to proceed. The joining bonus never has to be repaid.\n\nBest,\nPriya");
  for (const c of v.data.claims) console.log(c.verdict, c.claim, c.evidence?.quote||"");
}
