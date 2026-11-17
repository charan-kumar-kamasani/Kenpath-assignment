import express from 'express';
import { getApp, listApps, saveApp, addEvent, getEvents } from './db.js';
import { login, logout, requireAuth, sessionUser, cookieFor } from './auth.js';
import {
  REQUIRED_DOCS, SLA_DAYS, checkDocs, checkInspection, calcEligibility, priorityOf, recommend,
} from './rules.js';
import { DOC_NAMES, CROP_NAMES, CALAMITY_NAMES, withMessages, docsSummary, inspectionDraft, eligibilitySummary, decisionDraft, flagMessage } from './text.js';
import { narrate } from './ai.js';

export const api = express.Router();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
// Field officers (AEO) do steps 1-2 and may return a case; only the MAO sanctions (steps 3-4, approve, reject).
const isMao = (req, res) => (req.user.role === 'MAO' ? true : (bad(res, 'forbidden_role', 403), false));

// ---------- auth ----------
api.post('/login', (req, res) => {
  const r = login(req.body?.username, req.body?.password);
  if (!r) return bad(res, 'invalid_credentials', 401);
  res.setHeader('Set-Cookie', cookieFor(r.token));
  res.json({ user: r.user });
});
api.post('/logout', (req, res) => {
  logout(req);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  res.json({ ok: true });
});
api.get('/me', (req, res) => {
  const user = sessionUser(req);
  user ? res.json({ user, ai: Boolean(process.env.ANTHROPIC_API_KEY), meta: { docs: DOC_NAMES, crops: CROP_NAMES, calamities: CALAMITY_NAMES, required: REQUIRED_DOCS } }) : bad(res, 'unauthorized', 401);
});

api.use(requireAuth);

// ---------- helpers ----------
// Before step 1 is completed the flags are computed live from the documents.
function view(app, all = listApps()) {
  if (app.status === 'pending' && app.current_step === 1) app = { ...app, ai_flags: checkDocs(app, all) };
  const p = priorityOf(app);
  const rec = app.status === 'pending' && app.current_step >= 3 ? recommend(app) : null;
  return {
    ...app,
    ai_flags: withMessages(app.ai_flags),
    priority: p,
    recommendation: rec && { recommendation: rec.recommendation, blocking: withMessages(rec.blocking) },
  };
}
function mustBeWorkable(app, res) {
  if (!app) { bad(res, 'not_found', 404); return false; }
  if (app.status !== 'pending') { bad(res, 'not_pending'); return false; }
  return true;
}
function advance(app, from, user, detail) {
  saveApp(app.id, { current_step: from + 1 });
  addEvent(app.id, { actor: user.name, action: 'step_completed', step: from, detail });
}

// ---------- list + stats ----------
api.get('/applications', (req, res) => {
  const all = listApps();
  const rows = all.map((a) => {
    const v = view(a, all);
    return {
      id: a.id, ref_no: a.ref_no, farmer_name: a.farmer_name, village: a.village, crop: a.crop, calamity: a.calamity,
      area_ha: a.area_ha, status: a.status, current_step: a.current_step, submitted_at: a.submitted_at,
      flags: v.ai_flags.length, priority: v.priority,
    };
  });
  rows.sort((a, b) => (a.status === 'pending') === (b.status === 'pending')
    ? b.priority.score - a.priority.score || a.id - b.id
    : a.status === 'pending' ? -1 : 1);

  const pending = rows.filter((r) => r.status === 'pending');
  const stats = {
    total: rows.length,
    pending: pending.length,
    overdue: pending.filter((r) => r.priority.daysLeft < 0).length,
    dueSoon: pending.filter((r) => r.priority.daysLeft >= 0 && r.priority.daysLeft <= 3).length,
    returned: rows.filter((r) => r.status === 'returned').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
    slaDays: SLA_DAYS,
  };
  res.json({ applications: rows, stats });
});

api.get('/applications/:id', (req, res) => {
  const app = getApp(req.params.id);
  if (!app) return bad(res, 'not_found', 404);
  res.json({ application: view(app), events: getEvents(app.id) });
});

// ---------- step 1: documents ----------
api.post('/applications/:id/steps/1', (req, res) => {
  const app = getApp(req.params.id);
  if (!mustBeWorkable(app, res)) return;
  if (app.current_step !== 1) return bad(res, 'wrong_step');
  const verified = req.body?.verified || {};
  const note = String(req.body?.note || '').trim();
  const missing = REQUIRED_DOCS.filter((k) => !app.docs.find((d) => d.key === k)?.present);
  if (missing.length) return bad(res, 'missing_required_docs');
  if (REQUIRED_DOCS.some((k) => !verified[k])) return bad(res, 'verify_all_required');
  const flags = checkDocs(app, listApps());
  if (flags.some((f) => f.severity === 'high') && !note) return bad(res, 'override_note_required');
  saveApp(app.id, {
    verification: { verified, note, override_note: flags.some((f) => f.severity === 'high') ? note : '' },
    ai_flags: flags,
  });
  advance(app, 1, req.user, { note, flags: flags.length });
  res.json({ ok: true });
});

// ---------- step 2: field inspection ----------
api.post('/applications/:id/steps/2', (req, res) => {
  const app = getApp(req.params.id);
  if (!mustBeWorkable(app, res)) return;
  if (app.current_step !== 2) return bad(res, 'wrong_step');
  const { damage_pct, inspected_on, notes, report_te, report_en } = req.body || {};
  const dmg = Number(damage_pct);
  if (!Number.isFinite(dmg) || dmg < 0 || dmg > 100) return bad(res, 'invalid_damage');
  if (!inspected_on || Number.isNaN(Date.parse(inspected_on))) return bad(res, 'invalid_date');
  const inspFlags = checkInspection(app, dmg);
  const docFlags = app.ai_flags.filter((f) => !['damage_low', 'damage_high', 'borderline'].includes(f.code));
  saveApp(app.id, {
    inspection: { damage_pct: dmg, inspected_on, notes: String(notes || ''), report_te: report_te || '', report_en: report_en || '' },
    ai_flags: [...docFlags, ...inspFlags],
  });
  advance(app, 2, req.user, { damage_pct: dmg });
  res.json({ ok: true });
});

// ---------- step 3: eligibility (computed by rules, officer confirms area) ----------
api.post('/applications/:id/steps/3', (req, res) => {
  if (!isMao(req, res)) return;
  const app = getApp(req.params.id);
  if (!mustBeWorkable(app, res)) return;
  if (app.current_step !== 3) return bad(res, 'wrong_step');
  const area = Number(req.body?.verified_area_ha);
  if (!Number.isFinite(area) || area <= 0 || area > 50) return bad(res, 'invalid_area');
  const elig = calcEligibility({ irrigation: app.irrigation, verifiedAreaHa: area, damagePct: app.inspection.damage_pct });
  saveApp(app.id, { eligibility: elig });
  advance(app, 3, req.user, { verified_area_ha: area, amount: elig.amount, eligible: elig.eligible });
  res.json({ ok: true, eligibility: elig });
});

// ---------- step 4 / any time: final decision, always by the officer ----------
api.post('/applications/:id/decision', (req, res) => {
  const app = getApp(req.params.id);
  if (!mustBeWorkable(app, res)) return;
  const { decision, reason } = req.body || {};
  if (!['approve', 'reject', 'return'].includes(decision)) return bad(res, 'invalid_decision');
  if (decision !== 'return' && !isMao(req, res)) return;
  const why = String(reason || '').trim();
  if (decision !== 'approve' && !why) return bad(res, 'reason_required');
  if (decision === 'approve') {
    if (app.current_step !== 4 || !app.eligibility?.eligible) return bad(res, 'cannot_approve');
  }
  const rec = app.current_step >= 3 ? recommend(app).recommendation : null;
  const status = { approve: 'approved', reject: 'rejected', return: 'returned' }[decision];
  saveApp(app.id, {
    status,
    decision: { decision, reason: why, by: req.user.name, at: new Date().toISOString(), ai_recommended: rec, followed_ai: rec === decision },
  });
  addEvent(app.id, {
    actor: req.user.name, action: status, step: app.current_step,
    detail: { reason: why, amount: decision === 'approve' ? app.eligibility.amount : null, ai_recommended: rec },
  });
  res.json({ ok: true, status });
});

// Farmer has corrected a returned application -> back to step 1
api.post('/applications/:id/reopen', (req, res) => {
  const app = getApp(req.params.id);
  if (!app) return bad(res, 'not_found', 404);
  if (app.status !== 'returned') return bad(res, 'not_returned');
  saveApp(app.id, { status: 'pending', current_step: 1, verification: null, inspection: null, eligibility: null, decision: null, ai_flags: [] });
  addEvent(app.id, { actor: req.user.name, action: 'reopened', step: 1 });
  res.json({ ok: true });
});

// ---------- AI assistance ----------
api.post('/applications/:id/ai/:kind', async (req, res) => {
  const app = getApp(req.params.id);
  if (!mustBeWorkable(app, res)) return;
  const { kind } = req.params;
  let facts, fallback, step;

  if (kind === 'docs') {
    step = 1;
    const flags = checkDocs(app, listApps());
    facts = { application: brief(app), flags: flags.map((f) => ({ ...f, text: flagMessage(f).en })) };
    fallback = docsSummary(flags);
    var outFlags = withMessages(flags);
  } else if (kind === 'inspection') {
    step = 2;
    const dmg = Number(req.body?.damage_pct);
    if (!Number.isFinite(dmg) || dmg < 0 || dmg > 100) return bad(res, 'invalid_damage');
    const notes = String(req.body?.notes || '').slice(0, 1500);
    const flags = checkInspection(app, dmg);
    facts = { application: brief(app), damage_pct: dmg, officer_notes: notes, flags: flags.map((f) => ({ ...f, text: flagMessage(f).en })) };
    fallback = inspectionDraft(app, { damage_pct: dmg, notes });
    var outFlags = withMessages(flags);
  } else if (kind === 'eligibility') {
    step = 3;
    if (!app.inspection) return bad(res, 'wrong_step');
    const area = Number(req.body?.verified_area_ha);
    if (!Number.isFinite(area) || area <= 0) return bad(res, 'invalid_area');
    const e = calcEligibility({ irrigation: app.irrigation, verifiedAreaHa: area, damagePct: app.inspection.damage_pct });
    facts = { application: brief(app), eligibility: e };
    fallback = eligibilitySummary(e);
    var calc = e;
  } else if (kind === 'decision') {
    step = 4;
    if (!app.eligibility) return bad(res, 'wrong_step');
    const rec = recommend(app);
    facts = { application: brief(app), recommendation: rec.recommendation, blocking: rec.blocking.map((f) => flagMessage(f).en), eligibility: app.eligibility, open_flags: app.ai_flags.map((f) => flagMessage(f).en) };
    fallback = decisionDraft(app, rec, app.eligibility);
    var recommendation = rec.recommendation;
  } else return bad(res, 'unknown_kind', 404);

  const text = await narrate(kind, facts, fallback);
  addEvent(app.id, { actor: req.user.name, action: 'ai_assist', step, detail: { kind }, ai_source: text.source });
  res.json({ kind, text, flags: outFlags, eligibility: calc, recommendation });
});

const brief = (a) => ({
  farmer: a.farmer_name, village: a.village, survey_no: a.survey_no, crop: a.crop, calamity: a.calamity,
  irrigation: a.irrigation, claimed_area_ha: a.area_ha,
});
