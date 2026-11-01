// OfferLens analysis pipeline.
//   1. Extract  -> the offer's key terms, verbatim, with character offsets (missing = null)
//   2. Decide   -> clause-level risk checks with probabilities (+ employment type, overall risk)
//   3. Fill     -> the action record: evidence sentence per risk, recommended next step,
//                  plain-English summary, and a draft email to HR built from steps 1-2
//   4. Verify   -> the generated summary and email are checked claim by claim against the offer
//   (Protect runs separately, on demand, to make a shareable redacted copy.)
import { clocked } from "./clocked.js";

export const MAX_CHARS = 20000;

// ---------- 1. Extract: key terms ----------
export const TERMS = {
  employer: { label: "Employer", description: "name of the company making the job offer" },
  role: { label: "Role", description: "job title being offered" },
  manager: { label: "Reports to", description: "name of the person the candidate will report to" },
  work_location: { label: "Work location", description: "city or office where the candidate will work" },
  base_salary: { label: "Base pay", description: "fixed salary, base salary, or contract fee amount and its period", normalize: "money" },
  variable_pay: { label: "Bonus / variable pay", description: "annual performance or target bonus, as an amount or percentage" },
  joining_bonus: { label: "Joining / signing bonus", description: "one-time joining or signing bonus amount", normalize: "money" },
  equity: { label: "Equity", description: "stock options, RSUs or other equity grant" },
  start_date: { label: "Start date", description: "the candidate's joining or start date", normalize: "date" },
  probation: { label: "Probation", description: "length of the probation period" },
  notice_period: { label: "Notice period", description: "notice the employee must give to resign" },
  non_compete: { label: "Non-compete", description: "how long the employee is restricted from joining competitors after leaving" },
  early_exit_cost: { label: "Early-exit cost", description: "amount the employee must pay or repay as damages or bond for leaving before a minimum period", normalize: "money" },
  paid_leave: { label: "Paid leave", description: "number of paid leave, vacation or PTO days per year" },
  health_cover: { label: "Health cover", description: "health or medical insurance coverage" },
  working_hours: { label: "Working hours", description: "standard working hours or working days" },
  offer_deadline: { label: "Reply by", description: "date by which the offer must be accepted or returned", normalize: "date" },
  hr_contact: { label: "Reply to", description: "name of the person to reply to or return the signed offer to" },
  hr_email: { label: "Reply email", description: "email address to reply to or return the signed offer to", format: "email" },
};

// Terms that a candidate should normally see in writing; if missing they become questions.
// Contractors are not normally given paid leave or health cover, so those are not expected.
const EXPECTED_EMPLOYEE = ["base_salary", "start_date", "notice_period", "paid_leave", "health_cover", "working_hours", "work_location"];
const EXPECTED_CONTRACTOR = ["base_salary", "start_date", "notice_period", "working_hours"];
export function expectedTerms(employmentChoice) {
  return employmentChoice === "contractor" ? EXPECTED_CONTRACTOR : EXPECTED_EMPLOYEE;
}

// ---------- 2. Decide: clause checks ----------
export const CHECKS = {
  early_exit_penalty: {
    label: "Pay to leave early",
    ask: "Does the offer require the employee to pay money, liquidated damages, or repay a bonus if they leave before a minimum period?",
    why: "Bonds and clawbacks make leaving expensive. Know the exact amount and whether it reduces over time.",
  },
  broad_non_compete: {
    label: "Broad non-compete",
    ask: "After the employee leaves, does the offer bar them from working for other companies for more than 6 months, or across a whole industry or country?",
    why: "A wide non-compete can block your next job. Ask to narrow its length, scope and geography.",
  },
  one_sided_changes: {
    label: "Employer can change terms at will",
    ask: "Does the offer let the employer change pay, benefits or other terms at any time without the employee's agreement?",
    why: "A unilateral-change clause means the numbers you sign today are not guaranteed.",
  },
  unpaid_extra_hours: {
    label: "Unpaid extra hours",
    ask: "Does the offer require extra hours, weekend work or on-call shifts without additional pay?",
    why: "Open-ended unpaid hours change your effective pay. Ask how often and whether there is comp-off.",
  },
  ip_overreach: {
    label: "IP clause covers your own time",
    ask: "Does the intellectual-property clause claim work the employee creates outside working hours or without company resources?",
    why: "This can capture side projects and open-source work. Ask for a personal-time carve-out.",
  },
  notice_imbalance: {
    label: "One-sided notice",
    ask: "Must the employee give much longer notice than the employer, or is the employee prevented from buying out the notice period?",
    why: "Long one-sided notice slows your next move and weakens your negotiating position.",
  },
  discretionary_pay: {
    label: "Pay at management's discretion",
    ask: "Is a substantial part of pay, such as a bonus or variable pay, entirely at management's discretion with no written criteria?",
    why: "Treat discretionary pay as zero when comparing offers, unless the criteria are written down.",
  },
  extendable_probation: {
    label: "Open-ended probation",
    ask: "Can the employer extend the probation period at its own discretion, or end employment during probation with very short notice?",
    why: "Probation is when you are easiest to let go. Ask for a fixed maximum and fair notice.",
  },
  transfer_at_will: {
    label: "Transfer anywhere",
    ask: "Can the employer transfer or relocate the employee to another city or site at its discretion?",
    why: "If location matters to you, ask for it to be fixed in writing or for relocation support.",
  },
};

export const RISK_LEVELS = [
  "Low: standard, candidate-friendly terms",
  "Moderate: a few clauses worth clarifying",
  "High: several clauses that shift significant risk onto the candidate",
  "Severe: terms that could trap or heavily penalise the candidate",
];

// App policy on top of Decide probabilities.
export const POLICY = { flag: 0.75, review: 0.35 };
export function band(p) {
  if (p >= POLICY.flag) return "flag";
  if (p >= POLICY.review) return "review";
  return "clear";
}

const READ_RULES =
  "The source is a job offer letter or employment contract. Read only what it states. " +
  "Do not assume terms that are not written down. Prefer the most specific clause.";

async function runExtract(text) {
  const fields = {};
  for (const [k, v] of Object.entries(TERMS)) {
    const f = { description: v.description };
    if (v.normalize) f.normalize = v.normalize;
    if (v.format) f.format = v.format;
    fields[k] = f;
  }
  return clocked("extract", { text, fields, instructions: READ_RULES + " Leave a field empty when the offer does not state it." });
}

async function runDecide(text) {
  const questions = {};
  for (const [k, v] of Object.entries(CHECKS)) {
    questions[k] = { type: "noul", instructions: v.ask + " Answer yes only if the offer text explicitly says so.", threshold: POLICY.flag };
  }
  questions.employment_type = {
    type: "choice",
    instructions: "What kind of engagement does the offer describe?",
    criteria: {
      permanent: "Full-time permanent or at-will employment",
      fixed_term: "Fixed-term contract employment",
      internship: "Internship or apprenticeship",
      contractor: "Independent contractor or consultant",
      not_established: "The text does not establish it",
    },
  };
  questions.overall_risk = {
    type: "score",
    instructions: "Overall, how much risk do the offer's terms place on the candidate?",
    criteria: RISK_LEVELS,
  };
  return clocked("decide", { state: text, questions, instructions: READ_RULES });
}

function summariseFindings(terms, checks) {
  const flagged = checks.filter((c) => c.band === "flag");
  const review = checks.filter((c) => c.band === "review");
  const missing = terms.filter((t) => t.value == null && t.expected);
  return { flagged, review, missing };
}

async function runFill(text, terms, checks) {
  const { flagged, review, missing } = summariseFindings(terms, checks);
  const fields = {};
  // Evidence sentence for every flagged / review clause (verbatim, never inferred).
  for (const c of [...flagged, ...review]) {
    fields[`clause_${c.key}`] = {
      type: "extract",
      description: `The sentence of the offer that ${CHECKS[c.key].ask.replace(/^Does the offer |^Can the employer |^Must the employee |^Is /, "").replace(/\?$/, "")}`,
      unit: "sentence",
      infer: false,
      list: true,
      max_items: 3,
    };
  }
  fields.next_step = {
    type: "choice",
    description: "Given the risks listed in the instructions, what should the candidate do before signing?",
    options: ["Sign as is", "Sign after clarifying a few points", "Negotiate before signing", "Get legal advice before signing"],
  };
  fields.summary = {
    type: "generate",
    description: "A plain-English summary of the offer for the candidate in at most three sentences: role, pay, start date and the most important risk. State only facts written in the offer.",
    max_tokens: 140,
    format: "text",
  };
  fields.email_subject = {
    type: "generate",
    description: "A short, polite subject line for the candidate's email to HR asking to clarify the offer.",
    max_tokens: 24,
    format: "text",
  };
  fields.email_body = {
    type: "generate",
    description:
      "A polite, concise email from the candidate to the HR contact named in the offer. Thank them, then ask numbered questions: one for each risk and each missing term listed in the instructions. Quote numbers only as written in the offer. Do not accept or reject the offer. Do not invent facts. Sign off as the candidate.",
    max_tokens: 380,
    format: "text",
  };
  const lines = [];
  lines.push(READ_RULES);
  lines.push("Risks found by the clause checks (flagged = likely present, review = uncertain):");
  for (const c of flagged) lines.push(`- flagged: ${c.label} (${Math.round(c.p * 100)}%)`);
  for (const c of review) lines.push(`- review: ${c.label} (${Math.round(c.p * 100)}%)`);
  if (!flagged.length && !review.length) lines.push("- none");
  lines.push("Terms the offer does not state: " + (missing.length ? missing.map((m) => m.label).join(", ") : "none"));
  return clocked("fill", { text, fields, instructions: lines.join("\n") });
}

export async function runVerify(text, summary, email) {
  const answer = [summary, email].filter(Boolean).join("\n\n");
  if (!answer.trim()) return null;
  return clocked("grounding", {
    documents: [{ id: "offer", text }],
    answer,
    evidence: "flagged",
    threshold: 0.6,
    instructions:
      "Check only factual statements about the offer's terms (amounts, dates, durations, names, obligations). " +
      "Questions, thanks and requests for clarification are not claims.",
  });
}

export async function analyse(text) {
  const usage = [];
  const [ex, de] = await Promise.all([runExtract(text), runDecide(text)]);
  usage.push(ex.meta, de.meta);

  const answers = de.data.answers || {};
  const employment = answers.employment_type || null;
  const expected = expectedTerms(employment?.choice);
  const terms = Object.entries(TERMS).map(([key, v]) => {
    const f = ex.data.fields?.[key] || {};
    return {
      key,
      label: v.label,
      value: f.value ?? null,
      normalized: f.normalized ?? null,
      start: f.start ?? null,
      end: f.end ?? null,
      confidence: f.confidence ?? null,
      expected: expected.includes(key),
    };
  });

  const checks = Object.entries(CHECKS)
    .map(([key, v]) => {
      const p = answers[key]?.noul ?? 0;
      return { key, label: v.label, why: v.why, p, band: band(p) };
    })
    .sort((a, b) => b.p - a.p);
  const risk = answers.overall_risk || null;

  let fill = null, verify = null, errors = [];
  try {
    const f = await runFill(text, terms, checks);
    usage.push(f.meta);
    fill = f.data.fields || {};
    // Attach clause evidence to checks
    for (const c of checks) {
      const ev = fill[`clause_${c.key}`];
      if (!ev) continue;
      const items = Array.isArray(ev.items) && ev.items.length
        ? ev.items
        : Array.isArray(ev.value) ? ev.value.map((v) => ({ value: v })) : ev.value ? [ev] : [];
      const quotes = items
        .filter((it) => it && it.value)
        .map((it) => ({ value: it.value, start: it.start ?? null, end: it.end ?? null, confidence: it.confidence ?? null }));
      if (quotes.length) c.evidence = quotes;
    }
  } catch (e) {
    errors.push({ step: "fill", message: e.message });
  }

  if (fill) {
    try {
      const v = await runVerify(text, fill.summary?.value, fill.email_body?.value);
      if (v) { usage.push(v.meta); verify = v.data; }
    } catch (e) {
      errors.push({ step: "verify", message: e.message });
    }
  }

  return {
    terms,
    checks,
    employment,
    risk: risk ? { ...risk, levels: RISK_LEVELS } : null,
    next_step: fill?.next_step || null,
    summary: fill?.summary || null,
    email: fill ? { subject: fill.email_subject?.value || "", body: fill.email_body?.value || "", to: terms.find((t) => t.key === "hr_email")?.value || null } : null,
    verify,
    policy: POLICY,
    usage,
    credits: usage.reduce((s, u) => s + (u.credits || 0), 0),
    errors,
  };
}

// ---------- Protect: shareable redacted copy ----------
export async function redact(text, knownNames = []) {
  // Names that Extract already found (manager, reply-to contact) are passed as explicit
  // deny phrases, so Protect masks them even where its own read is unsure.
  const deny = {};
  for (const n of knownNames) {
    if (typeof n === "string" && n.length > 2 && n.length < 80 && text.includes(n)) deny[n] = "person";
  }
  const r = await clocked("pii", {
    text,
    entities: {
      person: null,
      email: null,
      phone: null,
      address: null,
      government_id: "Government or tax identifiers such as PAN, Aadhaar, SSN or passport numbers",
      reference_number: "Employee IDs, offer letter reference numbers or candidate IDs",
    },
    ...(Object.keys(deny).length ? { deny } : {}),
    anonymize: "replace",
    threshold: 0.5,
  });
  const entities = r.data.entities || [];
  // Protect finds full names; a letter often greets the person by first name alone ("Dear Priya,").
  // Mask those follow-up mentions too, using the names Protect found.
  let out = r.data.anonymized_text || "";
  let extra = 0;
  const firsts = new Set(
    entities.filter((e) => e.type === "person").map((e) => e.value.replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, "").split(/\s+/)[0]).filter((n) => n && n.length > 1)
  );
  for (const n of firsts) {
    const re = new RegExp(`(?<![\\p{L}<])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}>])`, "gu");
    out = out.replace(re, () => { extra++; return "<PERSON>"; });
  }
  return { anonymized_text: out, entities, counts: r.data.counts || {}, first_name_mentions_masked: extra, usage: [r.meta], credits: r.meta.credits };
}
