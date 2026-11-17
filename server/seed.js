// Demo data: realistic applications at different stages, with back-dated history.
import { db, getApp, saveApp, addEvent } from './db.js';
import { hashPassword } from './auth.js';
import { checkDocs, checkInspection, calcEligibility } from './rules.js';
import { listApps } from './db.js';

const MANDAL = 'పెదపారుపూడి';
const ago = (days, hour = 10) => {
  const d = new Date(); d.setDate(d.getDate() - days); d.setHours(hour, 0, 0, 0); return d.toISOString();
};
const day = (days) => ago(days).slice(0, 10);

const doc = (key, over = {}) => ({ key, present: true, ...over });
const fullDocs = (a) => [
  doc('passbook', { name: a.farmer_name, survey_no: a.survey_no }),
  doc('aadhaar', { name: a.farmer_name, last4: a.aadhaar_last4 }),
  doc('bank', { name: a.farmer_name, last4: a.account_last4 }),
  doc('ecrop', { name: a.farmer_name, survey_no: a.survey_no }),
  doc('photo'),
];

const FARMERS = [
  // [farmer, father, village, survey, ha, crop, irrigation, calamity, calamityDaysAgo, submittedDaysAgo, progress, tweak]
  ['కొల్లి వెంకట రావు', 'కొల్లి అప్పారావు', 'కాకర్లమూడి', '112/3', 1.2, 'paddy', 'irrigated', 'flood', 40, 19, 0],
  ['షేక్ మస్తాన్ వలి', 'షేక్ ఖాసిం', 'వెంట్రప్రగడ', '45/1A', 0.8, 'blackgram', 'rainfed', 'flood', 38, 12, 0, { dropDoc: 'bank' }],
  ['పాలడుగు సీతారామయ్య', 'పాలడుగు రాములు', 'యనమలకుదురు', '208/2', 2.0, 'paddy', 'irrigated', 'flood', 36, 9, 0, { passbookSurvey: '208/5', passbookName: 'పాలడుగు సీతారామరావు' }],
  ['గుమ్మడి లక్ష్మి', 'గుమ్మడి నాగేశ్వరరావు', 'ఉప్పలూరు', '77/4', 1.5, 'paddy', 'irrigated', 'cyclone', 30, 14, 1],
  ['బండారు రమణ', 'బండారు చిన్నయ్య', 'నిమ్మకూరు', '301/1', 1.0, 'cotton', 'rainfed', 'drought', 55, 6, 2, { damage: 28 }],
  ['మన్నె శ్రీనివాస్', 'మన్నె గోపాల్', 'పెదకళ్లేపల్లి', '156/2', 1.5, 'chilli', 'irrigated', 'hailstorm', 25, 10, 3, { damage: 55 }],
  ['తుమ్మల రాజేశ్వరి', 'తుమ్మల వీరయ్య', 'కాకర్లమూడి', '12/6', 3.2, 'banana', 'perennial', 'cyclone', 28, 8, 3, { damage: 70 }],
  ['ఆరేపల్లి నాగరాజు', 'ఆరేపల్లి సుబ్బయ్య', 'వెంట్రప్రగడ', '98/2', 1.0, 'maize', 'rainfed', 'flood', 34, 5, 0],
  ['ఆరేపల్లి నాగరాజు', 'ఆరేపల్లి సుబ్బయ్య', 'వెంట్రప్రగడ', '98/2', 1.0, 'maize', 'rainfed', 'flood', 34, 2, 0],
  ['చిలుకూరి పద్మ', 'చిలుకూరి రామ్మూర్తి', 'ఉప్పలూరు', '64/3', 1.8, 'paddy', 'irrigated', 'cyclone', 60, 30, 4, { final: 'approved', damage: 62 }],
  ['నల్లమోతు కృష్ణ', 'నల్లమోతు బాబు', 'యనమలకుదురు', '19/1', 0.9, 'groundnut', 'rainfed', 'drought', 62, 28, 4, { final: 'rejected', damage: 22 }],
  ['దాసరి భాస్కర్', 'దాసరి యేసు', 'నిమ్మకూరు', '240/7', 1.1, 'cotton', 'rainfed', 'pest', 45, 16, 5],
];

export function seedIfEmpty({ reset = false } = {}) {
  if (reset) {
    db.exec('DELETE FROM events; DELETE FROM applications; DELETE FROM sessions; DELETE FROM users;');
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    const ins = db.prepare('INSERT INTO users (username, password_hash, name, name_te, role) VALUES (?,?,?,?,?)');
    const pw = process.env.DEMO_PASSWORD || 'Rythu@2026';
    ins.run('mao', hashPassword(pw), 'K. Lakshmi (Mandal Agriculture Officer)', 'కె. లక్ష్మి (మండల వ్యవసాయ అధికారి)', 'MAO');
    ins.run('aeo', hashPassword(pw), 'P. Ravi (Agriculture Extension Officer)', 'పి. రవి (వ్యవసాయ విస్తరణ అధికారి)', 'AEO');
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM applications').get().n > 0) return;

  const ins = db.prepare(`INSERT INTO applications
    (ref_no, farmer_name, father_name, village, mandal, phone, survey_no, area_ha, crop, irrigation, calamity, calamity_date,
     aadhaar_last4, account_last4, submitted_at, docs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  FARMERS.forEach(([name, father, village, survey, ha, crop, irr, cal, calAgo, subAgo, progress, tweak = {}], i) => {
    const a = {
      farmer_name: name, survey_no: survey,
      aadhaar_last4: String(4000 + i * 137).slice(-4), account_last4: String(7000 + i * 211).slice(-4),
    };
    let docs = fullDocs(a);
    if (tweak.dropDoc) docs = docs.map((d) => (d.key === tweak.dropDoc ? { key: d.key, present: false } : d));
    if (tweak.passbookSurvey) docs = docs.map((d) => (d.key === 'passbook' ? { ...d, survey_no: tweak.passbookSurvey, name: tweak.passbookName || d.name } : d));
    const ref = `CL-2026-${String(101 + i).padStart(4, '0')}`;
    const r = ins.run(ref, name, father, village, MANDAL, `98480${String(10000 + i * 777).slice(-5)}`, survey, ha, crop, irr, cal, day(calAgo),
      a.aadhaar_last4, a.account_last4, ago(subAgo, 9), JSON.stringify(docs));
    const id = Number(r.lastInsertRowid);
    addEvent(id, { actor: 'Farmer (Meeseva)', action: 'submitted', at: ago(subAgo, 9) });

    // Replay workflow progress with back-dated events, using the real rule functions.
    let step = 1;
    if (progress >= 1) {
      const flags = checkDocs(getApp(id), listApps());
      const note = flags.some((f) => f.severity === 'high') ? 'Verified manually with VRO' : '';
      saveApp(id, { verification: { verified: { passbook: true, aadhaar: true, bank: true, ecrop: true }, note, override_note: note }, ai_flags: flags });
      addEvent(id, { actor: 'P. Ravi (Agriculture Extension Officer)', action: 'step_completed', step: 1, detail: { flags: flags.length }, at: ago(Math.max(subAgo - 2, 1), 11) });
      step = 2;
    }
    if (progress >= 2) {
      const dmg = tweak.damage ?? 60;
      const cur = getApp(id);
      const insp = { damage_pct: dmg, inspected_on: day(Math.max(subAgo - 4, 1)), notes: 'Visited field with VRO; crop lodged / damaged.', report_te: '', report_en: '' };
      saveApp(id, { inspection: insp, ai_flags: [...cur.ai_flags, ...checkInspection(cur, dmg)] });
      addEvent(id, { actor: 'P. Ravi (Agriculture Extension Officer)', action: 'step_completed', step: 2, detail: { damage_pct: dmg }, at: ago(Math.max(subAgo - 4, 1), 12) });
      step = 3;
    }
    if (progress >= 3) {
      const cur = getApp(id);
      const el = calcEligibility({ irrigation: irr, verifiedAreaHa: ha, damagePct: cur.inspection.damage_pct });
      saveApp(id, { eligibility: el });
      addEvent(id, { actor: 'K. Lakshmi (Mandal Agriculture Officer)', action: 'step_completed', step: 3, detail: { verified_area_ha: ha, amount: el.amount, eligible: el.eligible }, at: ago(Math.max(subAgo - 5, 1), 15) });
      step = 4;
    }
    if (progress === 2) step = 3;
    saveApp(id, { current_step: step });

    const final = tweak.final || (progress === 5 ? 'returned' : null);
    if (final) {
      const status = final;
      const reason = final === 'approved' ? '' : final === 'rejected' ? 'Crop loss below 33% minimum.' : 'ఇ-పంట నమోదు తప్పుగా ఉంది — సరిచేసి మళ్లీ దరఖాస్తు చేయండి (e-Crop entry incorrect; please correct and resubmit).';
      saveApp(id, { status, current_step: 4, decision: { decision: { approved: 'approve', rejected: 'reject', returned: 'return' }[status], reason, by: 'K. Lakshmi (Mandal Agriculture Officer)', at: ago(1, 16) } });
      addEvent(id, { actor: 'K. Lakshmi (Mandal Agriculture Officer)', action: status, step: 4, detail: { reason }, at: ago(1, 16) });
    }
  });
}

if (process.argv.includes('--reset')) {
  seedIfEmpty({ reset: true });
  console.log('Database reset and re-seeded.');
}
