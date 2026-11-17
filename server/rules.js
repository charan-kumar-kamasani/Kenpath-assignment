// Deterministic business rules. Money and eligibility are NEVER decided by an LLM.
// Rates/thresholds follow the SDRF/NDRF input-subsidy norms (simplified for the demo):
//  - crop loss must be >= 33% to qualify
//  - subsidy per hectare depends on irrigation type
//  - maximum 2 hectares per farmer

export const SLA_DAYS = 15;
export const DAMAGE_THRESHOLD = 33;
export const MAX_HECTARES = 2;
export const RATE_PER_HA = { rainfed: 8500, irrigated: 17000, perennial: 22500 };

export const REQUIRED_DOCS = ['passbook', 'aadhaar', 'bank', 'ecrop'];
export const OPTIONAL_DOCS = ['photo'];

// Typical damage ranges per calamity (demo stand-in for satellite / rainfall data).
export const EXPECTED_DAMAGE = {
  flood: [40, 95],
  cyclone: [40, 90],
  drought: [30, 80],
  hailstorm: [20, 70],
  pest: [20, 60],
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s.\-_,]/g, '');
const daysBetween = (a, b) => Math.floor((b - a) / 86400000);

export function calcEligibility({ irrigation, verifiedAreaHa, damagePct }) {
  const area = Number(verifiedAreaHa);
  const dmg = Number(damagePct);
  const rate = RATE_PER_HA[irrigation] ?? 0;
  const payableArea = Math.min(area, MAX_HECTARES);
  const meetsThreshold = dmg >= DAMAGE_THRESHOLD;
  const amount = meetsThreshold ? Math.round(payableArea * rate) : 0;
  return {
    eligible: meetsThreshold && area > 0,
    meetsThreshold,
    verifiedAreaHa: area,
    payableAreaHa: payableArea,
    cappedAtMax: area > MAX_HECTARES,
    ratePerHa: rate,
    damagePct: dmg,
    amount,
  };
}

/** Cross-checks on the documents. Returns flags: { code, severity: 'high'|'medium'|'low', params } */
export function checkDocs(app, allApps) {
  const flags = [];
  const docs = Object.fromEntries((app.docs || []).map((d) => [d.key, d]));

  for (const key of REQUIRED_DOCS) {
    if (!docs[key]?.present) flags.push({ code: 'missing_doc', severity: 'high', params: { doc: key } });
  }
  for (const d of Object.values(docs)) {
    if (!d.present) continue;
    if (d.name && norm(d.name) !== norm(app.farmer_name) &&
        !norm(d.name).includes(norm(app.farmer_name)) && !norm(app.farmer_name).includes(norm(d.name))) {
      flags.push({ code: 'name_mismatch', severity: 'medium', params: { doc: d.key, found: d.name, expected: app.farmer_name } });
    }
    if (d.survey_no && norm(d.survey_no) !== norm(app.survey_no)) {
      flags.push({ code: 'survey_mismatch', severity: 'high', params: { doc: d.key, found: d.survey_no, expected: app.survey_no } });
    }
    if (d.last4 && d.key === 'aadhaar' && d.last4 !== app.aadhaar_last4) {
      flags.push({ code: 'aadhaar_mismatch', severity: 'high', params: { found: d.last4, expected: app.aadhaar_last4 } });
    }
    if (d.last4 && d.key === 'bank' && d.last4 !== app.account_last4) {
      flags.push({ code: 'bank_mismatch', severity: 'high', params: { found: d.last4, expected: app.account_last4 } });
    }
  }
  const dup = (allApps || []).find(
    (o) => o.id !== app.id && norm(o.survey_no) === norm(app.survey_no) &&
      o.calamity_date === app.calamity_date && o.status !== 'rejected',
  );
  if (dup) flags.push({ code: 'duplicate', severity: 'high', params: { other: dup.ref_no } });
  return flags;
}

/** Sanity-check the officer's field damage figure against typical ranges. */
export function checkInspection(app, damagePct) {
  const flags = [];
  const d = Number(damagePct);
  const [lo, hi] = EXPECTED_DAMAGE[app.calamity] || [0, 100];
  if (d < lo) flags.push({ code: 'damage_low', severity: 'low', params: { damage: d, lo, hi } });
  if (d > hi) flags.push({ code: 'damage_high', severity: 'medium', params: { damage: d, lo, hi } });
  if (d >= DAMAGE_THRESHOLD && d <= DAMAGE_THRESHOLD + 3) {
    flags.push({ code: 'borderline', severity: 'medium', params: { damage: d } });
  }
  return flags;
}

/**
 * Priority = what the worker should open first.
 * Overdue applications dominate, then those close to the SLA, then risk flags and amount.
 */
export function priorityOf(app, now = new Date()) {
  const age = daysBetween(new Date(app.submitted_at), now);
  const left = SLA_DAYS - age;
  const reasons = [];
  let score = 0;
  if (app.status === 'pending') {
    if (left < 0) { score += 100 + Math.abs(left) * 5; reasons.push({ code: 'overdue', params: { days: Math.abs(left) } }); }
    else if (left <= 3) { score += 60 + (3 - left) * 5; reasons.push({ code: 'due_soon', params: { days: left } }); }
    else score += Math.max(0, age);
    const flags = app.ai_flags || [];
    const high = flags.filter((f) => f.severity === 'high').length;
    if (high) { score += 20 + high * 5; reasons.push({ code: 'has_flags', params: { count: flags.length } }); }
    if (app.current_step === 4) { score += 15; reasons.push({ code: 'ready_to_decide', params: {} }); }
  }
  return { age, daysLeft: left, score, reasons };
}

/**
 * Suggested decision (the officer always makes the final call).
 * - unresolved high-severity document flags  -> return to farmer
 * - below damage threshold                   -> reject
 * - otherwise                                -> approve
 */
export function recommend(app) {
  const overridden = Boolean(app.verification?.override_note);
  const blocking = (app.ai_flags || []).filter(
    (f) => f.severity === 'high' && (f.code === 'missing_doc' || !overridden),
  );
  if (blocking.length) return { recommendation: 'return', blocking };
  if (app.eligibility && !app.eligibility.eligible) return { recommendation: 'reject', blocking: [] };
  return { recommendation: 'approve', blocking: [] };
}
