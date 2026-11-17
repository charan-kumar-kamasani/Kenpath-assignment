// Bilingual (Telugu / English) text used by the rule engine and as the offline fallback for AI.
import { DAMAGE_THRESHOLD, MAX_HECTARES } from './rules.js';

export const DOC_NAMES = {
  passbook: { te: 'పట్టాదారు పాస్‌బుక్', en: 'Pattadar passbook' },
  aadhaar: { te: 'ఆధార్ కార్డు', en: 'Aadhaar card' },
  bank: { te: 'బ్యాంకు పాస్‌బుక్', en: 'Bank passbook' },
  ecrop: { te: 'ఇ-పంట నమోదు', en: 'e-Crop booking' },
  photo: { te: 'పొలం ఫొటో', en: 'Field photo' },
};

export const CROP_NAMES = {
  paddy: { te: 'వరి', en: 'Paddy' },
  cotton: { te: 'పత్తి', en: 'Cotton' },
  chilli: { te: 'మిరప', en: 'Chilli' },
  maize: { te: 'మొక్కజొన్న', en: 'Maize' },
  groundnut: { te: 'వేరుశనగ', en: 'Groundnut' },
  banana: { te: 'అరటి', en: 'Banana' },
  blackgram: { te: 'మినుము', en: 'Black gram' },
};

export const CALAMITY_NAMES = {
  flood: { te: 'వరదలు', en: 'Flood' },
  cyclone: { te: 'తుఫాను', en: 'Cyclone' },
  drought: { te: 'కరువు', en: 'Drought' },
  hailstorm: { te: 'వడగళ్ల వాన', en: 'Hailstorm' },
  pest: { te: 'తెగుళ్ల దాడి', en: 'Pest attack' },
};

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const d = (k) => DOC_NAMES[k] || { te: k, en: k };

/** Turn a rule flag into a human message in both languages. */
export function flagMessage(f) {
  const p = f.params || {};
  switch (f.code) {
    case 'missing_doc':
      return { te: `${d(p.doc).te} అందుబాటులో లేదు`, en: `${d(p.doc).en} is missing` };
    case 'name_mismatch':
      return { te: `${d(p.doc).te}లో పేరు "${p.found}" — దరఖాస్తులో "${p.expected}"`, en: `Name on ${d(p.doc).en} is "${p.found}" but application says "${p.expected}"` };
    case 'survey_mismatch':
      return { te: `${d(p.doc).te}లో సర్వే నంబర్ ${p.found} — దరఖాస్తులో ${p.expected}`, en: `Survey no. on ${d(p.doc).en} is ${p.found} but application says ${p.expected}` };
    case 'aadhaar_mismatch':
      return { te: `ఆధార్ చివరి 4 అంకెలు సరిపోలలేదు (${p.found} ≠ ${p.expected})`, en: `Aadhaar last 4 digits differ (${p.found} vs ${p.expected})` };
    case 'bank_mismatch':
      return { te: `బ్యాంకు ఖాతా చివరి 4 అంకెలు సరిపోలలేదు (${p.found} ≠ ${p.expected})`, en: `Bank account last 4 digits differ (${p.found} vs ${p.expected})` };
    case 'duplicate':
      return { te: `ఇదే సర్వే నంబర్, ఇదే తేదీకి మరో దరఖాస్తు ఉంది (${p.other})`, en: `Another application exists for the same survey no. and date (${p.other})` };
    case 'damage_low':
      return { te: `నష్టం ${p.damage}% — ఈ విపత్తుకు సాధారణ పరిధి ${p.lo}–${p.hi}%`, en: `${p.damage}% is below the usual ${p.lo}–${p.hi}% for this calamity` };
    case 'damage_high':
      return { te: `నష్టం ${p.damage}% — సాధారణ పరిధి (${p.lo}–${p.hi}%) కంటే ఎక్కువ; ఫొటోలతో నిర్ధారించండి`, en: `${p.damage}% is above the usual ${p.lo}–${p.hi}%; confirm with photos` };
    case 'borderline':
      return { te: `నష్టం ${p.damage}% — ${DAMAGE_THRESHOLD}% పరిమితికి చాలా దగ్గరగా ఉంది; మళ్లీ సరిచూడండి`, en: `${p.damage}% is very close to the ${DAMAGE_THRESHOLD}% cut-off; re-check` };
    default:
      return { te: f.code, en: f.code };
  }
}

export const withMessages = (flags) => flags.map((f) => ({ ...f, message: flagMessage(f) }));

// ---------- Offline templates (used when no API key / API failure) ----------

export function docsSummary(flags) {
  if (!flags.length) {
    return { te: 'అన్ని పత్రాలు ఉన్నాయి, పేరు/సర్వే నంబర్/ఆధార్/బ్యాంకు వివరాలు సరిపోలాయి. సమస్యలు కనిపించలేదు.', en: 'All documents are present and name, survey no., Aadhaar and bank details match. No issues found.' };
  }
  const te = flags.map((f, i) => `${i + 1}. ${flagMessage(f).te}`).join('\n');
  const en = flags.map((f, i) => `${i + 1}. ${flagMessage(f).en}`).join('\n');
  return { te: `ఈ సమస్యలను పరిశీలించండి:\n${te}`, en: `Please review these issues:\n${en}` };
}

export function inspectionDraft(app, { damage_pct, notes }) {
  const c = CALAMITY_NAMES[app.calamity], cr = CROP_NAMES[app.crop];
  const n = (notes || '').trim();
  return {
    te: `క్షేత్ర పరిశీలన నివేదిక: ${app.village} గ్రామం, సర్వే నం. ${app.survey_no}లో రైతు ${app.farmer_name} సాగు చేసిన ${cr.te} పంట ${c.te} కారణంగా దెబ్బతిన్నది. పరిశీలనలో పంట నష్టం సుమారు ${damage_pct}% గా అంచనా వేయబడింది.${n ? ' క్షేత్రస్థాయి గమనికలు: ' + n : ''}`,
    en: `Field inspection report: the ${cr.en} crop of ${app.farmer_name} on survey no. ${app.survey_no}, ${app.village}, was damaged by ${c.en.toLowerCase()}. Crop loss is assessed at approximately ${damage_pct}%.${n ? ' Field notes: ' + n : ''}`,
  };
}

export function eligibilitySummary(e) {
  if (!e.meetsThreshold) {
    return { te: `పంట నష్టం ${e.damagePct}% — కనీస పరిమితి ${DAMAGE_THRESHOLD}% కంటే తక్కువ, కాబట్టి ఇన్‌పుట్ సబ్సిడీకి అర్హత లేదు.`, en: `Crop loss is ${e.damagePct}%, below the ${DAMAGE_THRESHOLD}% minimum, so the farmer is not eligible for input subsidy.` };
  }
  const cap = e.cappedAtMax ? { te: ` (గరిష్ట పరిమితి ${MAX_HECTARES} హెక్టార్లు వర్తించింది)`, en: ` (capped at the ${MAX_HECTARES} ha maximum)` } : { te: '', en: '' };
  return {
    te: `పంట నష్టం ${e.damagePct}% (≥ ${DAMAGE_THRESHOLD}%) కాబట్టి అర్హులు. లెక్క: ${e.payableAreaHa} హెక్టార్లు × ${inr(e.ratePerHa)} = ${inr(e.amount)}${cap.te}.`,
    en: `Crop loss ${e.damagePct}% (≥ ${DAMAGE_THRESHOLD}%) so the farmer is eligible. Calculation: ${e.payableAreaHa} ha × ${inr(e.ratePerHa)} = ${inr(e.amount)}${cap.en}.`,
  };
}

export function decisionDraft(app, rec, e) {
  if (rec.recommendation === 'approve') {
    return { te: `అన్ని దశలు పూర్తయ్యాయి, పంట నష్టం ${e.damagePct}%. ${inr(e.amount)} ఇన్‌పుట్ సబ్సిడీ మంజూరు చేయవచ్చు.`, en: `All steps are complete and crop loss is ${e.damagePct}%. Input subsidy of ${inr(e.amount)} can be sanctioned.` };
  }
  if (rec.recommendation === 'reject') {
    return { te: `పంట నష్టం ${DAMAGE_THRESHOLD}% కంటే తక్కువగా ఉన్నందున (${e.damagePct}%) దరఖాస్తును తిరస్కరించవచ్చు.`, en: `The application can be rejected because crop loss (${e.damagePct}%) is below the ${DAMAGE_THRESHOLD}% minimum.` };
  }
  const issues = rec.blocking.map((f) => flagMessage(f));
  return { te: `ఈ సమస్యలు పరిష్కారమయ్యే వరకు రైతుకు తిరిగి పంపండి: ${issues.map((m) => m.te).join('; ')}.`, en: `Return to the farmer until these are resolved: ${issues.map((m) => m.en).join('; ')}.` };
}
