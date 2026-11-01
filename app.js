// OfferLens front end. All Clocked calls go through the OfferLens backend (/api/*);
// the browser never sees the API key.
const params = new URLSearchParams(location.search);
const API = (params.get("api") || window.OFFERLENS_API || "").replace(/\/$/, "");
// Static demo mode: on GitHub Pages (or ?static=1, or file://) there is no /api backend,
// so the page replays the recorded Clocked responses in public/samples/ and says so.
const STATIC = !params.get("api") && !window.OFFERLENS_API &&
  (params.get("static") === "1" || /\.github\.io$/.test(location.hostname) || location.protocol === "file:");
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (p) => `${Math.round((p ?? 0) * 100)}%`;

if (STATIC) {
  const b = document.createElement("div");
  b.id = "staticBanner";
  b.className = "static-banner";
  b.setAttribute("role", "note");
  b.innerHTML = `<b>Recorded sample mode.</b> This static copy has no server, so it cannot call Clocked live. Pick one of the three samples to replay its recorded Clocked responses (Extract, Decide, Fill, Verify, Protect). To analyse your own offer, run OfferLens locally with your own <code>CLOCKED_API_KEY</code>: see the <a href="https://github.com/cryptocloud786/offerlens#setup" target="_blank" rel="noopener">README</a>.`;
  document.body.prepend(b);
  document.documentElement.classList.add("static-mode");
}

const state = { text: "", result: null, sample: null, samples: {}, verifiedDraft: null };

const ENDPOINT_NOTES = {
  extract: "19 key terms, verbatim with offsets",
  decide: "9 clause checks + engagement type + overall risk",
  fill: "clause evidence, next step, summary, HR email",
  grounding: "claim-by-claim check of the generated text",
  pii: "redacted copy for sharing",
};

// ---------- offsets: Clocked returns Unicode code point offsets; JS strings are UTF-16 ----------
function cpIndex(text) {
  const map = [0];
  let u = 0;
  for (const ch of text) { u += ch.length; map.push(u); }
  return (cp) => map[Math.max(0, Math.min(cp, map.length - 1))];
}

// ---------- input ----------
const offer = $("#offer");
offer.addEventListener("input", () => {
  $("#charcount").textContent = `${offer.value.length.toLocaleString()} characters`;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", state.samples[c.dataset.sample] === offer.value));
});
document.querySelectorAll("[data-sample]").forEach((b) =>
  b.addEventListener("click", async () => {
    const name = b.dataset.sample;
    if (!state.samples[name]) state.samples[name] = await (await fetch(`samples/${name}.txt`)).text();
    offer.value = state.samples[name];
    offer.dispatchEvent(new Event("input"));
  })
);

function sampleNameFor(text) {
  return Object.entries(state.samples).find(([, t]) => t.trim() === text.trim())?.[0] || null;
}

function setStatus(html, cls = "") {
  $("#status").innerHTML = html ? `<div class="box ${cls}">${html}</div>` : "";
}

async function post(path, body) {
  if (STATIC) throw new Error("static demo, no live API");
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

$("#analyse").addEventListener("click", run);
async function run() {
  const text = offer.value.replace(/\r\n/g, "\n");
  if (text.trim().length < 80) { setStatus("Paste the full offer letter first, or pick a sample.", "err"); return; }
  const btn = $("#analyse");
  btn.disabled = true; btn.textContent = "Analysing…";
  setStatus(`<span>Reading the letter</span><span class="pipeline"><span class="run">Extract</span><span class="run">Decide</span><span class="run">Fill</span><span class="run">Verify</span></span>`);
  const t0 = performance.now();
  let result, notice = null;
  try {
    result = await post("/api/analyze", { text });
    notice = result.notice || null;
  } catch (e) {
    const name = sampleNameFor(text);
    if (name) {
      result = await (await fetch(`samples/${name}.analysis.json`)).json();
      result.recorded = true;
      notice = STATIC
        ? "Recorded sample mode: replaying the saved Clocked response for this sample."
        : `Live analysis unavailable (${e.message}). Showing the recorded Clocked response for this sample.`;
    } else {
      setStatus(STATIC
        ? "This static demo can only replay the three built-in samples. Pick a sample above, or run OfferLens locally with your own Clocked key to analyse this letter."
        : `Could not analyse the offer: ${esc(e.message)}. Nothing was changed; you can try again.`, "err");
      btn.disabled = false; btn.textContent = "Analyse offer";
      return;
    }
  }
  btn.disabled = false; btn.textContent = "Analyse offer";
  state.text = text; state.result = result; state.sample = sampleNameFor(text);
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  const parts = [];
  if (result.recorded) parts.push(`<b>Recorded result</b>${result.recorded_at ? ` from ${esc(result.recorded_at.slice(0, 10))}` : ""}.`);
  else parts.push(`Done in ${secs}s using ${result.credits} Clocked credits${result.cached ? " (cached)" : ""}.`);
  if (notice) parts.push(esc(notice));
  if (result.errors?.length) parts.push(`Some steps failed and are shown as unavailable: ${result.errors.map((e) => esc(`${e.step}: ${e.message}`)).join("; ")}.`);
  setStatus(`<span class="pipeline"><span class="done">Extract</span><span class="done">Decide</span><span class="${result.summary ? "done" : ""}">Fill</span><span class="${result.verify ? "done" : ""}">Verify</span></span><span>${parts.join(" ")}</span>`, notice || result.errors?.length ? "note" : "");
  render(result, text);
}

// ---------- render ----------
function render(r, text) {
  $("#results").hidden = false;
  document.querySelectorAll("[data-policy]").forEach((el) => (el.textContent = pct(r.policy?.[el.dataset.policy])));
  renderVerdict(r);
  renderSummary(r);
  renderChecks(r);
  renderTerms(r);
  renderSource(r, text);
  renderEmail(r);
  renderUsage(r);
  $("#redacted").hidden = true;
  $("#raw").textContent = JSON.stringify(r, null, 2);
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderVerdict(r) {
  const flagged = r.checks.filter((c) => c.band === "flag").length;
  const review = r.checks.filter((c) => c.band === "review").length;
  const missing = r.terms.filter((t) => t.expected && t.value == null).length;
  const ns = r.next_step;
  const risk = r.risk;
  const colors = ["#2f6b3a", "#a15c00", "#c2410c", "#b42318"];
  const bars = risk
    ? risk.levels.map((lvl, i) => {
        const p = risk.probabilities?.[String(i)] ?? 0;
        return `<div title="${esc(lvl)}: ${pct(p)}"><b>${pct(p)}</b><i style="height:${Math.max(4, p * 100)}%;background:${colors[i]}33;border-top:2px solid ${colors[i]}"></i></div>`;
      }).join("")
    : "";
  const top = risk ? risk.levels[Math.round(risk.score)]?.split(":")[0] : "Unknown";
  const emp = r.employment;
  const empLabel = { permanent: "Permanent / at-will employment", fixed_term: "Fixed-term employment", internship: "Internship", contractor: "Independent contractor", not_established: "Not stated" }[emp?.choice] || "—";
  $("#verdict").innerHTML = `
    <div class="card-head"><h2>Verdict</h2><span class="tag">Decide</span><span class="tag">Fill</span></div>
    <div class="big">${esc(ns?.value || "Review the letter yourself")}</div>
    <div class="sub">${ns ? `Recommended next step · ${pct(ns.probabilities?.[ns.value] ?? ns.confidence)} likely` : "Fill step unavailable"}</div>
    <div class="riskbar">${bars}</div>
    <div class="risklabels"><span>Low</span><span>Moderate</span><span>High</span><span>Severe</span></div>
    <div class="kv"><span>Overall risk</span><b>${esc(top)}</b></div>
    <div class="kv"><span>Red flags · to review</span><b>${flagged} · ${review}</b></div>
    <div class="kv"><span>Expected terms not in writing</span><b>${missing}</b></div>
    <div class="kv"><span>Engagement</span><span>${esc(empLabel)} <span class="pct">${emp ? pct(emp.confidence) : ""}</span></span></div>`;
}

function claimsFor(r) {
  return (r.verify?.claims || []).filter((c) => c.verdict !== "not_a_claim");
}

function markClaims(str, claims) {
  // Wrap each verified claim found in str with a coloured underline.
  let html = esc(str);
  for (const c of claims) {
    const t = esc(c.claim.trim());
    if (!t || !html.includes(t)) continue;
    const cls = c.verdict === "supported" ? "" : c.verdict === "contradicted" ? "bad" : "unk";
    html = html.replace(t, `<span class="claimmark ${cls}" title="Verify: ${esc(c.verdict.replace("_", " "))} (${pct(c.supported)} supported)">${t}</span>`);
  }
  return html;
}

function renderSummary(r) {
  const s = r.summary?.value;
  const claims = claimsFor(r);
  const inSummary = claims.filter((c) => s && s.includes(c.claim.trim()));
  const ok = inSummary.filter((c) => c.verdict === "supported").length;
  $("#summary").innerHTML = `
    <div class="card-head"><h2>In plain English</h2><span class="tag">Fill</span><span class="tag">Verify</span></div>
    ${s ? `<p>${markClaims(s, inSummary)}</p>
      <p class="muted small">${inSummary.length ? `${ok} of ${inSummary.length} factual claims supported by the letter (underlined; red = contradicted, amber = not stated).` : "Verify step unavailable: read the summary as a draft."}</p>`
      : `<p class="muted">Summary unavailable for this run.</p>`}`;
}

function renderChecks(r) {
  const shown = r.checks.filter((c) => c.band !== "clear");
  const clear = r.checks.filter((c) => c.band === "clear");
  const item = (c) => `
    <li class="${c.band}">
      <div class="check-top">
        <span class="name">${esc(c.label)}</span>
        <span class="prob" title="Decide: ${pct(c.p)} yes"><i style="width:${c.p * 100}%;background:${c.band === "flag" ? "var(--flag)" : "var(--review)"}"></i></span>
        <span class="pct">${pct(c.p)}</span>
        <span class="badge ${c.band}">${c.band === "flag" ? "Red flag" : "Review"}</span>
      </div>
      ${c.evidence?.length ? c.evidence.map((q) => `<div class="quote" data-start="${q.start ?? ""}" data-end="${q.end ?? ""}" title="Show in the letter">“${esc(q.value)}”</div>`).join("") : `<div class="why">No single clause located; read the letter for this one.</div>`}
      <p class="why">${esc(c.why)}</p>
    </li>`;
  $("#checks").innerHTML =
    (shown.length ? shown.map(item).join("") : `<li class="clear"><b>No risky clauses found.</b> <span class="muted small">All nine checks came back below ${pct(r.policy.review)}.</span></li>`) +
    (clear.length ? `<li class="clear clear-list">Clear: ${clear.map((c) => `${esc(c.label)} <span class="pct">${pct(c.p)}</span>`).join(" · ")}</li>` : "");
  $("#checks").querySelectorAll(".quote").forEach((q) => q.addEventListener("click", () => focusSpan(q.dataset.start, q.dataset.end)));
}

function renderTerms(r) {
  const fmtNorm = (n) => {
    if (!n || n.value == null) return "";
    const v = typeof n.value === "object" ? [n.value.amount, n.value.currency].filter(Boolean).join(" ") : n.value;
    return v ? `<span class="norm">${esc(v)}</span>` : "";
  };
  $("#terms").innerHTML = r.terms
    .map((t) => {
      if (t.value == null) {
        return `<tr><td>${esc(t.label)}</td><td>${t.expected ? `<span class="missing">Not stated: ask HR</span>` : `<span class="none">Not mentioned</span>`}</td></tr>`;
      }
      return `<tr><td>${esc(t.label)}</td><td><span class="val" data-start="${t.start ?? ""}" data-end="${t.end ?? ""}">${esc(t.value)}</span>${fmtNorm(t.normalized)}${t.confidence != null && t.confidence < 0.8 ? `<span class="conf">${pct(t.confidence)} sure</span>` : ""}</td></tr>`;
    })
    .join("");
  $("#terms").querySelectorAll(".val").forEach((v) => v.addEventListener("click", () => focusSpan(v.dataset.start, v.dataset.end)));
}

function renderSource(r, text) {
  const u = cpIndex(text);
  const spans = [];
  for (const t of r.terms) if (t.start != null && t.end != null) spans.push({ s: u(t.start), e: u(t.end), cls: "term", id: `${t.start}-${t.end}`, title: t.label });
  for (const c of r.checks) {
    if (c.band === "clear") continue;
    for (const q of c.evidence || []) if (q.start != null && q.end != null) spans.push({ s: u(q.start), e: u(q.end), cls: c.band, id: `${q.start}-${q.end}`, title: c.label });
  }
  const cuts = new Set([0, text.length]);
  spans.forEach((sp) => { cuts.add(sp.s); cuts.add(sp.e); });
  const pts = [...cuts].sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const seg = text.slice(a, b);
    const act = spans.filter((sp) => sp.s <= a && sp.e >= b);
    if (!act.length) { html += esc(seg); continue; }
    const cls = [...new Set(act.map((x) => x.cls))].join(" ");
    const ids = act.map((x) => x.id).join(" ");
    const title = act.map((x) => x.title).join(" · ");
    html += `<mark class="${cls}" data-ids="${ids}" title="${esc(title)}">${esc(seg)}</mark>`;
  }
  $("#source").innerHTML = html;
}

function focusSpan(start, end) {
  if (start === "" || end === "") return;
  const id = `${start}-${end}`;
  const marks = [...document.querySelectorAll("#source mark")].filter((m) => m.dataset.ids.split(" ").includes(id));
  document.querySelectorAll("#source mark.pulse").forEach((m) => m.classList.remove("pulse"));
  if (!marks.length) return;
  marks.forEach((m) => m.classList.add("pulse"));
  const box = $("#source");
  box.scrollTo({ top: marks[0].offsetTop - box.offsetTop - 80, behavior: "smooth" });
  if (window.innerWidth < 900) marks[0].scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- email + verify gate ----------
function renderEmail(r) {
  const e = r.email;
  if (!e) { $("#emailcard").hidden = true; return; }
  $("#emailcard").hidden = false;
  $("#emailTo").textContent = e.to || "(no reply address in the letter)";
  $("#emailSubject").value = e.subject;
  $("#emailBody").value = e.body;
  state.verifiedDraft = e.body;
  const emailClaims = claimsFor(r).filter((c) => e.body.includes(c.claim.trim()));
  showClaims(emailClaims, r.verify ? null : "Verify step unavailable for this run.");
  updateMailto();
}

function showClaims(claims, note) {
  const bad = claims.filter((c) => c.verdict === "contradicted" || c.verdict === "not_stated");
  const gate = $("#sendGate");
  if (note) { gate.className = "gate stale"; gate.textContent = note; }
  else if (bad.length) { gate.className = "gate bad"; gate.textContent = `Fix ${bad.length} claim${bad.length > 1 ? "s" : ""} before sending`; }
  else { gate.className = "gate ok"; gate.textContent = claims.length ? `✓ ${claims.length} factual claim${claims.length > 1 ? "s" : ""} checked against the offer` : "✓ No factual claims to check: only questions"; }
  $("#claims").innerHTML = claims
    .map((c) => `<li class="${c.verdict}"><span class="v">${esc(c.verdict.replace("_", " "))} ${pct(c.verdict === "supported" ? c.supported : c.verdict === "contradicted" ? c.contradicted : c.not_stated)}</span><span>${esc(c.claim)}${c.evidence?.quote && c.verdict !== "supported" ? `<span class="ev">Offer says: “${esc(c.evidence.quote)}”</span>` : ""}</span></li>`)
    .join("");
}

$("#emailBody").addEventListener("input", () => {
  updateMailto();
  if ($("#emailBody").value !== state.verifiedDraft) { const g = $("#sendGate"); g.className = "gate stale"; g.textContent = "Edited since the last check: re-check before sending"; }
});
$("#emailSubject").addEventListener("input", updateMailto);
function updateMailto() {
  const to = state.result?.email?.to || "";
  $("#mailto").href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent($("#emailSubject").value)}&body=${encodeURIComponent($("#emailBody").value)}`;
}
$("#copyEmail").addEventListener("click", async () => {
  await navigator.clipboard.writeText(`Subject: ${$("#emailSubject").value}\n\n${$("#emailBody").value}`);
  flash($("#copyEmail"), "Copied");
});
$("#recheck").addEventListener("click", async () => {
  if (STATIC) { const g = $("#sendGate"); g.className = "gate stale"; g.textContent = "Re-checking edits needs the live API: run OfferLens locally to use Verify on your own draft."; return; }
  const btn = $("#recheck"); btn.disabled = true; btn.textContent = "Checking…";
  try {
    const draft = $("#emailBody").value;
    const out = await post("/api/verify", { text: state.text, draft });
    state.verifiedDraft = draft;
    showClaims((out.verify?.claims || []).filter((c) => c.verdict !== "not_a_claim"));
    addUsage(out.usage, "re-check of your edited email");
  } catch (e) {
    const g = $("#sendGate"); g.className = "gate bad"; g.textContent = `Could not re-check (${e.message}). Read your edits against the letter before sending.`;
  }
  btn.disabled = false; btn.textContent = "Re-check my edits";
});

// ---------- protect ----------
$("#redact").addEventListener("click", async () => {
  const btn = $("#redact"); btn.disabled = true; btn.textContent = "Redacting…";
  const names = (state.result?.terms || []).filter((t) => ["manager", "hr_contact"].includes(t.key) && t.value).map((t) => t.value);
  let out;
  try {
    out = await post("/api/redact", { text: state.text, names });
  } catch (e) {
    if (state.sample) { out = await (await fetch(`samples/${state.sample}.redact.json`)).json(); out.recorded = true; }
    else { btn.disabled = false; btn.textContent = "Make a redacted copy"; setStatus(`Could not make a redacted copy: ${esc(e.message)}. Do not share the original.`, "err"); return; }
  }
  btn.disabled = false; btn.textContent = "Make a redacted copy";
  $("#redacted").hidden = false;
  const counts = Object.entries(out.counts || {}).map(([k, v]) => `<span>${v} ${esc(k.replace("_", " "))}</span>`).join("");
  $("#redactCounts").innerHTML = counts + (out.first_name_mentions_masked ? `<span>${out.first_name_mentions_masked} first-name mention(s)</span>` : "") + (out.recorded ? `<span>recorded result</span>` : "");
  $("#redactText").innerHTML = esc(out.anonymized_text).replace(/&lt;([A-Z_]+)&gt;/g, '<span class="ph">$1</span>');
  state.redacted = out.anonymized_text;
  if (out.usage) addUsage(out.usage, ENDPOINT_NOTES.pii);
});
$("#copyRedacted").addEventListener("click", async () => { await navigator.clipboard.writeText(state.redacted || ""); flash($("#copyRedacted"), "Copied"); });

// ---------- usage ----------
function renderUsage(r) {
  $("#usage").innerHTML = "";
  addUsage(r.usage || []);
}
function addUsage(rows, note) {
  $("#usage").insertAdjacentHTML("beforeend", rows.map((u) => `<tr><td><code>/clocked/${esc(u.endpoint)}</code></td><td>${esc(note || ENDPOINT_NOTES[u.endpoint] || "")}</td><td>${u.credits ?? ""}</td><td>${u.modelMs ? Math.round(u.modelMs) : ""}</td><td>${u.roundTripMs ?? ""}</td></tr>`).join(""));
}
function flash(el, txt) { const o = el.textContent; el.textContent = txt; setTimeout(() => (el.textContent = o), 1200); }

// Preload sample text so recorded fallbacks can be matched.
["brightcart", "launchpad", "northwind"].forEach(async (n) => { try { state.samples[n] = await (await fetch(`samples/${n}.txt`)).text(); } catch {} });
if (params.get("sample")) document.querySelector(`[data-sample="${params.get("sample")}"]`)?.click();
