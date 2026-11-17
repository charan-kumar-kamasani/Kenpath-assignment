import test from 'node:test';
import assert from 'node:assert/strict';
import { calcEligibility, checkDocs, checkInspection, priorityOf, recommend } from '../server/rules.js';

test('below 33% damage is not eligible and pays nothing', () => {
  const e = calcEligibility({ irrigation: 'rainfed', verifiedAreaHa: 1, damagePct: 28 });
  assert.equal(e.eligible, false); assert.equal(e.amount, 0);
});
test('33% damage qualifies; amount = area x rate', () => {
  const e = calcEligibility({ irrigation: 'irrigated', verifiedAreaHa: 1.5, damagePct: 33 });
  assert.equal(e.eligible, true); assert.equal(e.amount, 25500);
});
test('area is capped at 2 hectares', () => {
  const e = calcEligibility({ irrigation: 'perennial', verifiedAreaHa: 3.2, damagePct: 70 });
  assert.equal(e.cappedAtMax, true); assert.equal(e.amount, 45000);
});

const base = { id: 1, farmer_name: 'Ravi', survey_no: '10/1', aadhaar_last4: '1111', account_last4: '2222', calamity_date: '2026-10-01' };
const goodDocs = [
  { key: 'passbook', present: true, name: 'Ravi', survey_no: '10/1' }, { key: 'aadhaar', present: true, name: 'Ravi', last4: '1111' },
  { key: 'bank', present: true, name: 'Ravi', last4: '2222' }, { key: 'ecrop', present: true, name: 'Ravi', survey_no: '10/1' },
];
test('clean documents raise no flags', () => assert.deepEqual(checkDocs({ ...base, docs: goodDocs }, []), []));
test('missing document and survey mismatch are high severity', () => {
  const docs = goodDocs.filter((d) => d.key !== 'bank').map((d) => (d.key === 'passbook' ? { ...d, survey_no: '10/9' } : d));
  const codes = checkDocs({ ...base, docs }, []).map((f) => f.code);
  assert.ok(codes.includes('missing_doc') && codes.includes('survey_mismatch'));
});
test('duplicate claim for same survey + date is flagged', () => {
  const other = { ...base, id: 2, ref_no: 'X', status: 'pending' };
  assert.ok(checkDocs({ ...base, docs: goodDocs }, [other]).some((f) => f.code === 'duplicate'));
});
test('borderline damage is flagged', () => {
  assert.ok(checkInspection({ calamity: 'flood' }, 35).some((f) => f.code === 'borderline'));
});
test('overdue applications rank above fresh ones', () => {
  const old = priorityOf({ status: 'pending', submitted_at: new Date(Date.now() - 20 * 864e5).toISOString(), current_step: 1, ai_flags: [] });
  const fresh = priorityOf({ status: 'pending', submitted_at: new Date().toISOString(), current_step: 1, ai_flags: [] });
  assert.ok(old.score > fresh.score);
});
test('recommendation: return on unresolved flags, reject below threshold, else approve', () => {
  const flag = [{ code: 'survey_mismatch', severity: 'high' }];
  assert.equal(recommend({ ai_flags: flag, eligibility: { eligible: true } }).recommendation, 'return');
  assert.equal(recommend({ ai_flags: flag, verification: { override_note: 'ok' }, eligibility: { eligible: true } }).recommendation, 'approve');
  assert.equal(recommend({ ai_flags: [], eligibility: { eligible: false } }).recommendation, 'reject');
});
