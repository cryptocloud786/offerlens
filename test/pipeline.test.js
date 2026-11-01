// Offline tests: Clocked is mocked, so these run without a key or credits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { band, POLICY, expectedTerms, analyse } from "../lib/offerlens.js";
import { rateLimited } from "../lib/guard.js";

process.env.CLOCKED_API_KEY = "test";

function mockFetch(handlers) {
  globalThis.fetch = async (url, init) => {
    const ep = url.split("/").pop();
    const h = handlers[ep];
    const { status = 200, body } = typeof h === "function" ? h(JSON.parse(init.body)) : h;
    return new Response(JSON.stringify(body), { status, headers: { "x-clocked-credits": "1" } });
  };
}

test("probability bands follow the app policy", () => {
  assert.equal(band(POLICY.flag), "flag");
  assert.equal(band(0.5), "review");
  assert.equal(band(0.1), "clear");
});

test("contractors are not expected to have paid leave or health cover", () => {
  assert.ok(!expectedTerms("contractor").includes("paid_leave"));
  assert.ok(expectedTerms("permanent").includes("health_cover"));
});

test("missing terms stay null, flags carry evidence, and a failed Fill degrades instead of crashing", async () => {
  mockFetch({
    extract: { body: { fields: { role: { value: "Engineer", start: 0, end: 8, confidence: 1 }, paid_leave: { value: null, confidence: 0.97 } } } },
    decide: (req) => ({ body: { answers: Object.fromEntries(Object.keys(req.questions).map((k) => [k, k === "broad_non_compete" ? { noul: 0.93 } : k === "employment_type" ? { choice: "permanent", confidence: 0.9 } : k === "overall_risk" ? { score: 2 } : { noul: 0.02 }])) } }),
    fill: { status: 400, body: { error: "bad field" } },
  });
  const r = await analyse("Engineer offer text ".repeat(10));
  assert.equal(r.terms.find((t) => t.key === "paid_leave").value, null);
  assert.equal(r.terms.find((t) => t.key === "paid_leave").expected, true);
  assert.equal(r.checks[0].key, "broad_non_compete");
  assert.equal(r.checks[0].band, "flag");
  assert.equal(r.summary, null);
  assert.equal(r.errors[0].step, "fill");
});

test("retries a 429 with the same idempotency key", async () => {
  const keys = [];
  let n = 0;
  globalThis.fetch = async (url, init) => {
    keys.push(init.headers["Idempotency-Key"]);
    n++;
    return new Response(JSON.stringify(n === 1 ? { error: "busy" } : { fields: {}, answers: {} }), { status: n === 1 ? 429 : 200 });
  };
  const { clocked } = await import("../lib/clocked.js");
  await clocked("extract", { text: "x", fields: { a: "a" } });
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("rate limiter caps requests per IP", () => {
  let blocked = false;
  for (let i = 0; i < 25; i++) blocked = rateLimited("1.2.3.4");
  assert.equal(blocked, true);
});
