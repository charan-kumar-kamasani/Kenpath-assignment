import { t, pick, getLang, setLang } from './i18n.js';

// ---------- state & helpers ----------
const S = { user: null, ai: false, meta: null, list: null, filter: 'attention', detail: null, aiOut: {}, busy: false, decideMode: null };
const root = document.getElementById('root');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const locale = () => (getLang() === 'te' ? 'te-IN' : 'en-IN');
const fmtDate = (iso) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.body ? 'POST' : opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { S.user = null; render(); throw new Error('unauthorized'); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error });
  return data;
}

function toast(msg, bad = false) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.className = ''), 3200);
}
const errText = (e) => t('e_' + e.code) !== 'e_' + e.code ? t('e_' + e.code) : t('error');

const crop = (k) => pick(S.meta.crops[k]);
const calamity = (k) => pick(S.meta.calamities[k]);
const docName = (k) => pick(S.meta.docs[k]);

// ---------- routing ----------
const route = () => (location.hash.match(/^#\/app\/(\d+)/) || [])[1];

async function loadList() { S.list = await api('/applications'); }
async function loadDetail(id) { S.detail = await api('/applications/' + id); S.aiOut = {}; S.decideMode = null; }

async function navigate() {
  if (!S.user) return render();
  try {
    const id = route();
    if (id) await loadDetail(id); else { S.detail = null; await loadList(); }
  } catch (e) { if (e.message !== 'unauthorized') toast(errText(e), true); }
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', navigate);

// ---------- shell ----------
function header() {
  return `<header class="top">
    <a class="brand" href="#/"><span class="logo">🌾</span><span><b>${t('app')}</b><small>${t('tagline')}</small></span></a>
    <div class="top-right">
      <span class="chip ${S.ai ? 'ok' : ''}" title="${esc(S.ai ? t('aiOn') : t('aiOff'))}">${S.ai ? '✨ Claude' : '⚙ Rules'}</span>
      <div class="seg" role="group" aria-label="Language">
        <button data-act="lang" data-lang="te" class="${getLang() === 'te' ? 'on' : ''}">తెలుగు</button>
        <button data-act="lang" data-lang="en" class="${getLang() === 'en' ? 'on' : ''}">EN</button>
      </div>
      <span class="who">${esc(getLang() === 'te' ? S.user.name_te : S.user.name)}</span>
      <button class="btn ghost sm" data-act="logout">${t('logout')}</button>
    </div>
  </header>`;
}

function loginView() {
  return `<main class="login">
    <div class="seg floating">
      <button data-act="lang" data-lang="te" class="${getLang() === 'te' ? 'on' : ''}">తెలుగు</button>
      <button data-act="lang" data-lang="en" class="${getLang() === 'en' ? 'on' : ''}">EN</button>
    </div>
    <form class="card login-card" data-form="login">
      <div class="logo big">🌾</div>
      <h1>${t('app')}</h1>
      <p class="muted">${t('tagline')}</p>
      <label>${t('username')}<input name="username" autocomplete="username" value="mao" required></label>
      <label>${t('password')}<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary lg" type="submit">${t('login')}</button>
      <p class="demo"><b>${t('demoCreds')}:</b> mao / Rythu@2026 &nbsp;·&nbsp; aeo / Rythu@2026</p>
    </form>
  </main>`;
}

// ---------- dashboard ----------
const FILTERS = ['attention', 'pending', 'returned', 'done', 'all'];
const filterKey = { attention: 'filterAttention', pending: 'filterPending', returned: 'filterReturned', done: 'filterDone', all: 'filterAll' };

function applyFilter(rows) {
  switch (S.filter) {
    case 'attention': return rows.filter((r) => r.status === 'pending' && (r.priority.daysLeft <= 3 || r.flags > 0 || r.current_step === 4));
    case 'pending': return rows.filter((r) => r.status === 'pending');
    case 'returned': return rows.filter((r) => r.status === 'returned');
    case 'done': return rows.filter((r) => r.status === 'approved' || r.status === 'rejected');
    default: return rows;
  }
}

function dueLabel(p) {
  if (p.daysLeft < 0) return `<span class="due bad">${t('daysOverdue', -p.daysLeft)}</span>`;
  if (p.daysLeft === 0) return `<span class="due bad">${t('dueToday')}</span>`;
  return `<span class="due ${p.daysLeft <= 3 ? 'warn' : ''}">${t('daysLeft', p.daysLeft)}</span>`;
}

function stepDots(step, status) {
  return `<span class="dots" aria-label="${t('stepN', step)}">${[1, 2, 3, 4].map((n) =>
    `<i class="${status !== 'pending' || n < step ? 'full' : n === step ? 'cur' : ''}"></i>`).join('')}</span>`;
}

function dashboardView() {
  const { stats, applications } = S.list;
  const rows = applyFilter(applications);
  const card = (n, label, cls = '') => `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
  return `${header()}<main class="wrap">
    <section class="stats">
      ${card(stats.pending, t('pending'))}
      ${card(stats.overdue, t('overdue'), stats.overdue ? 'bad' : '')}
      ${card(stats.dueSoon, t('dueSoon'), stats.dueSoon ? 'warn' : '')}
      ${card(stats.returned, t('returned'))}
      ${card(stats.approved, t('approved'), 'ok')}
      ${card(stats.rejected, t('rejected'))}
    </section>
    <h2>${t('queueTitle')}</h2>
    <p class="muted sm">${t('slaNote', stats.slaDays)}</p>
    <nav class="filters" role="tablist">${FILTERS.map((f) =>
      `<button role="tab" class="${S.filter === f ? 'on' : ''}" data-act="filter" data-f="${f}">${t(filterKey[f])}</button>`).join('')}</nav>
    <div class="queue">${rows.length ? rows.map(rowCard).join('') : `<p class="empty">${t('noApps')}</p>`}</div>
  </main>`;
}

function rowCard(r) {
  const reasons = r.priority.reasons.map((x) => `<span class="tag ${x.code === 'overdue' ? 'bad' : x.code === 'due_soon' ? 'warn' : ''}">${esc(t('r_' + x.code, x.params))}</span>`).join('');
  return `<a class="card row ${r.status}" href="#/app/${r.id}">
    <div class="row-main">
      <div class="row-title"><b>${esc(r.farmer_name)}</b><span class="muted">${esc(r.village)} · ${esc(crop(r.crop))} · ${esc(calamity(r.calamity))} · ${r.area_ha} ${t('ha')}</span></div>
      <div class="row-tags">${reasons}${r.flags && r.status === 'pending' ? `<span class="tag warn">${t('flagsCount', r.flags)}</span>` : ''}</div>
    </div>
    <div class="row-side">
      ${r.status === 'pending' ? `${dueLabel(r.priority)}${stepDots(r.current_step, r.status)}<small>${t('stepN', r.current_step)}: ${t('steps')[r.current_step - 1]}</small>`
        : `<span class="badge ${r.status}">${t('status_' + r.status)}</span>`}
      <small class="muted">${esc(r.ref_no)}</small>
    </div>
  </a>`;
}

// ---------- detail ----------
function detailView() {
  const a = S.detail.application;
  const info = (k, v) => `<div><dt>${t(k)}</dt><dd>${v}</dd></div>`;
  return `${header()}<main class="wrap detail">
    <a class="back" href="#/">${t('back')}</a>
    <section class="card summary">
      <div class="summary-head">
        <div><h1>${esc(a.farmer_name)}</h1><span class="muted">${esc(a.ref_no)}</span></div>
        <div class="summary-right"><span class="badge ${a.status}">${t('status_' + a.status)}</span>${a.status === 'pending' ? dueLabel(a.priority) : ''}</div>
      </div>
      <dl class="facts">
        ${info('father', esc(a.father_name))}${info('village', `${esc(a.village)}, ${esc(a.mandal)}`)}${info('phone', esc(a.phone))}
        ${info('survey', esc(a.survey_no))}${info('area', `${a.area_ha} ${t('ha')}`)}${info('crop', esc(crop(a.crop)))}
        ${info('irrigation', t('irr_' + a.irrigation))}${info('calamity', esc(calamity(a.calamity)))}${info('calamityDate', fmtDate(a.calamity_date))}
        ${info('submitted', fmtDate(a.submitted_at))}
      </dl>
    </section>
    ${stepper(a)}
    ${a.status === 'pending' ? stepPanel(a) : finalPanel(a)}
    ${a.status === 'pending' ? decisionBar(a) : ''}
    ${historyView()}
  </main>`;
}

function stepper(a) {
  return `<ol class="stepper">${t('steps').map((label, i) => {
    const n = i + 1;
    const state = a.status !== 'pending' || n < a.current_step ? 'done' : n === a.current_step ? 'active' : '';
    return `<li class="${state}"><span class="num">${state === 'done' ? '✓' : n}</span><span class="lbl">${label}</span></li>`;
  }).join('')}</ol>`;
}

function flagList(flags) {
  if (!flags?.length) return '';
  return `<ul class="flags">${flags.map((f) => `<li class="${f.severity}"><span>⚠</span>${esc(pick(f.message))}</li>`).join('')}</ul>`;
}

function aiBox(kind, label, extraBody = null) {
  const out = S.aiOut[kind];
  const loading = S.busy === 'ai:' + kind;
  return `<div class="ai">
    <div class="ai-head"><b>✨ ${t('aiHelp')}</b>
      <button class="btn ai-btn" data-act="ai" data-kind="${kind}" ${loading ? 'disabled' : ''}>${loading ? t('aiWorking') : label}</button></div>
    ${out ? `<div class="ai-out">
        ${out.recommendation ? `<div class="rec ${out.recommendation}"><span>${t('aiSuggests')}:</span> <b>${t('rec_' + out.recommendation)}</b></div>` : ''}
        <p>${nl2br(pick(out.text))}</p>
        ${kind === 'docs' || kind === 'inspection' ? flagList(out.flags) : ''}
        <small class="muted">${t('aiBy_' + out.text.source)} · ${t('aiDisclaimer')}</small></div>` : ''}
    ${extraBody || ''}
  </div>`;
}

function stepPanel(a) {
  const n = a.current_step;
  const body = [null, docsStep, inspectionStep, eligibilityStep, decisionStep][n](a);
  return `<section class="card step"><h2><span class="num">${n}</span> ${t('steps')[n - 1]}</h2>${body}</section>`;
}

function docsStep(a) {
  const docs = Object.fromEntries(a.docs.map((d) => [d.key, d]));
  const all = [...S.meta.required, 'photo'];
  const missing = S.meta.required.some((k) => !docs[k]?.present);
  const liveFlags = a.ai_flags;
  const highFlags = liveFlags.some((f) => f.severity === 'high');
  return `<form data-form="step1">
    <ul class="docs">${all.map((k) => {
      const d = docs[k] || { present: false };
      const req = S.meta.required.includes(k);
      return `<li class="${d.present ? '' : 'missing'}">
        <div><b>${esc(docName(k))}</b> <span class="tag ${req ? '' : 'mute'}">${req ? t('required') : t('optional')}</span>
          <div class="muted sm">${d.present ? `${d.name ? `${t('nameOnDoc')}: ${esc(d.name)}` : ''}${d.survey_no ? ` · ${t('surveyOnDoc')}: ${esc(d.survey_no)}` : ''}${d.last4 ? ` · ••••${esc(d.last4)}` : ''}` : ''}</div></div>
        <div class="doc-right"><span class="badge ${d.present ? 'approved' : 'rejected'}">${d.present ? t('docPresent') : t('docMissing')}</span>
          ${d.present && req ? `<label class="check"><input type="checkbox" name="v_${k}"> ${t('docVerified')}</label>` : ''}</div></li>`;
    }).join('')}</ul>
    ${flagList(liveFlags)}
    ${aiBox('docs', t('aiDocs'))}
    ${missing ? `<p class="alert">${t('missingBlock')}</p>` : `
      <label>${highFlags ? t('overrideNote') : t('note')}<textarea name="note" rows="2" ${highFlags ? 'required' : ''}></textarea></label>
      <button class="btn primary lg" type="submit">${t('completeStep')}</button>`}
  </form>`;
}

function inspectionStep(a) {
  const o = S.aiOut.inspection;
  const today = new Date().toISOString().slice(0, 10);
  return `<form data-form="step2">
    <div class="grid2">
      <label>${t('damagePct')}<input name="damage_pct" type="number" min="0" max="100" step="1" inputmode="numeric" required></label>
      <label>${t('inspectedOn')}<input name="inspected_on" type="date" value="${today}" max="${today}" required></label>
    </div>
    <label>${t('fieldNotes')}<textarea name="notes" rows="3" placeholder="${esc(t('notesPlaceholder'))}"></textarea></label>
    ${aiBox('inspection', t('aiInspection'))}
    <label>${t('report')}<textarea name="report" rows="4">${o ? esc(pick(o.text)) : ''}</textarea></label>
    <button class="btn primary lg" type="submit">${t('completeStep')}</button>
  </form>`;
}

function calcCard(e) {
  return `<div class="calc ${e.eligible ? 'ok' : 'bad'}">
    <div class="calc-head"><b>${t('calcTitle')}</b><span class="badge ${e.eligible ? 'approved' : 'rejected'}">${e.eligible ? t('eligible') : t('notEligible')}</span></div>
    <dl class="facts">
      <div><dt>${t('damagePct')}</dt><dd>${e.damagePct}%</dd></div>
      <div><dt>${t('payableArea')}</dt><dd>${e.payableAreaHa} ${t('ha')}${e.cappedAtMax ? ` <span class="tag warn">${t('capped')}</span>` : ''}</dd></div>
      <div><dt>${t('rate')}</dt><dd>${inr(e.ratePerHa)}</dd></div>
      <div class="big"><dt>${t('amount')}</dt><dd>${inr(e.amount)}</dd></div>
    </dl></div>`;
}

function eligibilityStep(a) {
  const e = S.aiOut.eligibility?.eligibility;
  return `<form data-form="step3">
    <p class="muted">${t('claimedArea')}: <b>${a.area_ha} ${t('ha')}</b> · ${t('damagePct')}: <b>${a.inspection.damage_pct}%</b></p>
    <label>${t('verifiedArea')}<input name="verified_area_ha" type="number" min="0.1" max="50" step="0.1" value="${a.area_ha}" required></label>
    <div class="actions"><button class="btn" type="button" data-act="ai" data-kind="eligibility">${t('calculate')}</button></div>
    ${e ? calcCard(e) : ''}
    ${aiBox('eligibility', t('aiEligibility'))}
    ${flagList(a.ai_flags.filter((f) => ['damage_low', 'damage_high', 'borderline'].includes(f.code)))}
    <button class="btn primary lg" type="submit">${t('completeStep')}</button>
  </form>`;
}

function decisionStep(a) {
  return `<div>
    ${calcCard(a.eligibility)}
    ${flagList(a.ai_flags)}
    ${aiBox('decision', t('aiDecision'))}
    <p class="muted sm">${t('decisionTitle')} ↓</p></div>`;
}

function decisionBar(a) {
  const canApprove = a.current_step === 4 && a.eligibility?.eligible;
  if (S.decideMode) {
    const m = S.decideMode;
    return `<section class="card decide"><h3>${t(m === 'approve' ? 'approve' : m === 'reject' ? 'reject' : 'returnApp')}</h3>
      <form data-form="decision" data-mode="${m}">
        ${m === 'approve' ? `<p><b>${t('confirmApprove', inr(a.eligibility.amount))}</b></p>` : ''}
        <label>${t('reasonLabel')}<textarea name="reason" rows="3" ${m === 'approve' ? '' : 'required'}></textarea></label>
        <div class="actions"><button class="btn ${m === 'approve' ? 'primary' : m === 'reject' ? 'danger' : 'warnbtn'} lg" type="submit">${t('confirm')}</button>
          <button class="btn ghost lg" type="button" data-act="cancel-decide">${t('cancel')}</button></div>
      </form></section>`;
  }
  return `<section class="card decide"><h3>${t('decisionTitle')}</h3><p class="muted sm">${t('anytime')}</p>
    <div class="actions">
      ${canApprove ? `<button class="btn primary lg" data-act="decide" data-mode="approve">✔ ${t('approve')}</button>` : ''}
      <button class="btn warnbtn lg" data-act="decide" data-mode="return">↩ ${t('returnApp')}</button>
      <button class="btn danger lg" data-act="decide" data-mode="reject">✖ ${t('reject')}</button>
    </div></section>`;
}

function finalPanel(a) {
  const d = a.decision;
  return `<section class="card final ${a.status}"><h2>${t('decided')}: ${t('status_' + a.status)}</h2>
    ${a.eligibility && a.status === 'approved' ? calcCard(a.eligibility) : ''}
    ${d?.reason ? `<p><b>${t('reason')}:</b> ${esc(d.reason)}</p>` : ''}
    ${d ? `<p class="muted sm">${t('by')}: ${esc(d.by)} · ${fmtTime(d.at)}${d.ai_recommended ? ` · ${d.followed_ai ? t('aiFollowed') : t('aiOverrode')}` : ''}</p>` : ''}
    ${a.status === 'returned' ? `<button class="btn primary lg" data-act="reopen">${t('reopen')}</button>` : ''}</section>`;
}

function eventText(e) {
  switch (e.action) {
    case 'step_completed': return t('ev_step_completed', e.step) + ` — ${t('steps')[e.step - 1]}`;
    case 'ai_assist': return `${t('ev_ai_assist')} (${t('steps')[e.step - 1]})`;
    default: return t('ev_' + e.action);
  }
}

function historyView() {
  const evs = [...S.detail.events].reverse();
  return `<section class="card"><h2>${t('history')}</h2><ol class="timeline">${evs.map((e) => {
    const d = e.detail || {};
    const extra = [d.reason ? `${t('reason')}: ${esc(d.reason)}` : '', d.amount ? `${t('amountWord')}: ${inr(d.amount)}` : '',
      e.action === 'step_completed' && d.damage_pct != null ? `${t('damagePct')}: ${d.damage_pct}%` : '',
      e.action === 'step_completed' && d.note ? esc(d.note) : ''].filter(Boolean).join(' · ');
    return `<li class="${e.action}"><i></i><div><b>${eventText(e)}</b>${e.ai_source ? ` <span class="tag mute">${e.ai_source === 'claude' ? 'Claude' : 'Rules'}</span>` : ''}
      ${extra ? `<div class="sm">${extra}</div>` : ''}<div class="muted sm">${esc(e.actor)} · ${fmtTime(e.at)}</div></div></li>`;
  }).join('')}</ol></section>`;
}

// ---------- render ----------
function render() {
  const focus = document.activeElement?.name;
  if (!S.user) root.innerHTML = loginView();
  else root.innerHTML = route() && S.detail ? detailView() : S.list ? dashboardView() : '';
  if (focus) root.querySelector(`[name="${focus}"]`)?.focus?.();
}

// ---------- events ----------
const formData = (form) => Object.fromEntries(new FormData(form));

root.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const { act } = el.dataset;
  const id = route();
  try {
    if (act === 'lang') { setLang(el.dataset.lang); render(); }
    else if (act === 'logout') { await api('/logout', { body: {} }); S.user = null; location.hash = '#/'; render(); }
    else if (act === 'filter') { S.filter = el.dataset.f; render(); }
    else if (act === 'decide') { S.decideMode = el.dataset.mode; render(); }
    else if (act === 'cancel-decide') { S.decideMode = null; render(); }
    else if (act === 'reopen') { await api(`/applications/${id}/reopen`, { body: {} }); toast(t('saved')); await loadDetail(id); render(); }
    else if (act === 'ai') await runAi(el.dataset.kind);
  } catch (e) { if (e.message !== 'unauthorized') toast(errText(e), true); }
});

async function runAi(kind) {
  const id = route();
  const a = S.detail.application;
  const body = {};
  const form = root.querySelector('form[data-form]');
  if (kind === 'inspection') {
    const f = formData(form);
    if (f.damage_pct === '' || f.damage_pct == null) { toast(t('e_invalid_damage'), true); return; }
    body.damage_pct = Number(f.damage_pct); body.notes = f.notes;
  }
  if (kind === 'eligibility') body.verified_area_ha = Number(formData(form).verified_area_ha || a.area_ha);
  const keep = form && formData(form);
  S.busy = 'ai:' + kind; render(); restoreForm(keep);
  try {
    S.aiOut[kind] = await api(`/applications/${id}/ai/${kind}`, { body });
  } finally { S.busy = false; }
  render(); restoreForm(keep);
  if (kind === 'inspection') { // prefill the editable report once the draft arrives
    const ta = root.querySelector('[name="report"]'); if (ta) ta.value = pick(S.aiOut.inspection.text);
  }
}

// Re-render wipes inputs; put back what the officer already typed.
function restoreForm(values) {
  if (!values) return;
  const form = root.querySelector('form[data-form]');
  if (!form) return;
  for (const [k, v] of Object.entries(values)) {
    const el = form.elements[k];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = v === 'on'; else el.value = v;
  }
  form.querySelectorAll('input[type=checkbox]').forEach((c) => { if (!(c.name in values)) c.checked = false; });
}

root.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const f = formData(form);
  const id = route();
  try {
    switch (form.dataset.form) {
      case 'login': {
        const r = await api('/login', { body: f }).catch((e) => { toast(t('loginFailed'), true); throw e; });
        S.user = r.user; await bootstrap(); return;
      }
      case 'step1':
        await api(`/applications/${id}/steps/1`, { body: { note: f.note, verified: Object.fromEntries(S.meta.required.map((k) => [k, f['v_' + k] === 'on'])) } });
        break;
      case 'step2': {
        const draft = S.aiOut.inspection?.text;
        await api(`/applications/${id}/steps/2`, { body: { damage_pct: f.damage_pct, inspected_on: f.inspected_on, notes: f.notes, report_te: getLang() === 'te' ? f.report : draft?.te, report_en: getLang() === 'en' ? f.report : draft?.en } });
        break;
      }
      case 'step3': await api(`/applications/${id}/steps/3`, { body: { verified_area_ha: f.verified_area_ha } }); break;
      case 'decision': await api(`/applications/${id}/decision`, { body: { decision: form.dataset.mode, reason: f.reason } }); break;
    }
    toast(t('saved'));
    await loadDetail(id); render(); window.scrollTo(0, 0);
  } catch (e) { if (e.message !== 'unauthorized') toast(errText(e), true); }
});

// ---------- boot ----------
async function bootstrap() {
  const me = await api('/me');
  S.user = me.user; S.ai = me.ai; S.meta = me.meta;
  await navigate();
}
api('/me').then(async (me) => { S.user = me.user; S.ai = me.ai; S.meta = me.meta; await navigate(); }).catch(() => render());
