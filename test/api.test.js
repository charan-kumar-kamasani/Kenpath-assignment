import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}/api`;
let proc, dir;

async function req(method, url, { body, cookie } = {}) {
  const res = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const login = async (u) => (await req('POST', '/login', { body: { username: u, password: 'Rythu@2026' } })).cookie;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rythu-'));
  proc = spawn('node', ['--no-warnings', 'server/index.js'], { env: { ...process.env, PORT, DATA_DIR: dir, ANTHROPIC_API_KEY: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/healthz`)).ok) return; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('login required and bad password rejected', async () => {
  assert.equal((await req('GET', '/applications')).status, 401);
  assert.equal((await req('POST', '/login', { body: { username: 'mao', password: 'x' } })).status, 401);
});

test('queue is sorted with the overdue case first', async () => {
  const c = await login('mao');
  const { data } = await req('GET', '/applications', { cookie: c });
  assert.equal(data.applications[0].priority.daysLeft < 0, true);
  assert.equal(data.stats.total, 12);
});

test('AEO cannot approve, reject or run eligibility; MAO can', async () => {
  const aeo = await login('aeo');
  assert.equal((await req('POST', '/applications/6/decision', { cookie: aeo, body: { decision: 'approve' } })).status, 403);
  assert.equal((await req('POST', '/applications/6/decision', { cookie: aeo, body: { decision: 'reject', reason: 'x' } })).status, 403);
  assert.equal((await req('POST', '/applications/5/steps/3', { cookie: aeo, body: { verified_area_ha: 1 } })).status, 403);
});

test('full workflow: steps in order, AI assist, approve, audit history', async () => {
  const c = await login('mao');
  const id = 1;
  assert.equal((await req('POST', `/applications/${id}/steps/2`, { cookie: c, body: { damage_pct: 50, inspected_on: '2026-11-10' } })).status, 400); // wrong step
  const ai = await req('POST', `/applications/${id}/ai/docs`, { cookie: c });
  assert.equal(ai.data.text.source, 'rules');
  const all = { passbook: true, aadhaar: true, bank: true, ecrop: true };
  assert.equal((await req('POST', `/applications/${id}/steps/1`, { cookie: c, body: { verified: all } })).status, 200);
  assert.equal((await req('POST', `/applications/${id}/steps/2`, { cookie: c, body: { damage_pct: 60, inspected_on: '2026-11-10', notes: 'flooded' } })).status, 200);
  const e = await req('POST', `/applications/${id}/steps/3`, { cookie: c, body: { verified_area_ha: 1.2 } });
  assert.equal(e.data.eligibility.amount, 20400);
  assert.equal((await req('POST', `/applications/${id}/decision`, { cookie: c, body: { decision: 'approve' } })).status, 200);
  const { data } = await req('GET', `/applications/${id}`, { cookie: c });
  assert.equal(data.application.status, 'approved');
  assert.deepEqual(data.events.map((x) => x.action).filter((a) => a !== 'ai_assist'),
    ['submitted', 'step_completed', 'step_completed', 'step_completed', 'approved']);
  assert.equal((await req('POST', `/applications/${id}/decision`, { cookie: c, body: { decision: 'reject', reason: 'x' } })).status, 400); // already decided
});

test('reject and return need a reason; returned case can be reopened', async () => {
  const c = await login('mao');
  assert.equal((await req('POST', '/applications/8/decision', { cookie: c, body: { decision: 'reject' } })).data.error, 'reason_required');
  assert.equal((await req('POST', '/applications/8/decision', { cookie: c, body: { decision: 'return', reason: 'Fix e-Crop' } })).status, 200);
  assert.equal((await req('POST', '/applications/8/reopen', { cookie: c })).status, 200);
  const { data } = await req('GET', '/applications/8', { cookie: c });
  assert.equal(data.application.status, 'pending'); assert.equal(data.application.current_step, 1);
});

test('missing required document blocks step 1', async () => {
  const c = await login('mao');
  const r = await req('POST', '/applications/2/steps/1', { cookie: c, body: { verified: { passbook: true, aadhaar: true, bank: true, ecrop: true } } });
  assert.equal(r.data.error, 'missing_required_docs');
});
