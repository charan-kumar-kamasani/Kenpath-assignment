# రైతు సేవ · Rythu Seva

A Telugu-first workflow tool for **Mandal Agriculture Officers (MAO) and Agriculture Extension Officers (AEO)** in Andhra Pradesh to process **crop-loss input-subsidy applications** after floods, cyclones, drought, hailstorm or pest attack.

> Built for the Kenpath Full Stack AI Engineer assignment. Demo data is fictional.

**Live demo:** _add your deployed URL here_ · **Login:** `mao` / `Rythu@2026` (also `aeo` / `Rythu@2026`)

---

## 1. The problem and who it affects

After a calamity, a farmer who lost ≥33% of a crop can claim an **input subsidy** (SDRF/NDRF norms). In practice:

- The application lands on a mandal office with paper files and several disconnected portals (land records, e-Crop booking, Aadhaar, bank).
- The AEO/MAO must manually cross-check that the farmer's **name, survey number, Aadhaar and bank account** agree across documents, visit the field, record the damage %, calculate the amount (rate depends on irrigation type, capped at 2 ha), and finally decide.
- Mistakes are expensive: a typo in a survey number or a duplicate claim for the same plot is caught late (or never), so farmers get returned weeks after applying, and officers miss the **15-day SLA** because nothing tells them what is urgent.

It affects **small and marginal farmers** (delayed relief right when they need cash for the next season) and **field officers** who handle dozens of cases on a phone, in Telugu, often on weak networks.

## 2. What the application does

A worker logs in and sees a **priority queue**: overdue cases first, then those about to breach the SLA, then cases with document alerts or ready for decision. Each application moves through four steps:

| # | Step | What the worker does | Where the system helps |
|---|------|----------------------|------------------------|
| 1 | **పత్రాల పరిశీలన** Document check | Ticks each required document as verified (passbook, Aadhaar, bank, e-Crop) | Rules flag missing docs, name/survey/Aadhaar/bank mismatches and **duplicate claims**; AI explains them in Telugu |
| 2 | **క్షేత్ర పరిశీలన** Field inspection | Enters damage %, date, rough notes | Flags implausible or **borderline (33–36%)** figures; AI turns rough notes into a formal report (editable) |
| 3 | **అర్హత & సబ్సిడీ** Eligibility | Confirms the verified area | **Deterministic** calculation of amount; AI explains it step by step |
| 4 | **తుది నిర్ణయం** Decision | **Approve / Reject / Return to farmer** with a reason | AI suggests a decision with reasons — the officer always decides |

- **Reject or return is available at any step**; approve only after all steps and only if eligible.
- **History**: every action (who, when, step, reason, amount) and every use of AI is logged per application, including whether the officer followed the AI's suggestion.
- A returned application can be **reopened** once the farmer corrects it.
- > **Policy figures are demo assumptions.** The 33% threshold, 2 ha cap, per-hectare rates (₹8,500 / ₹17,000 / ₹22,500) and 15-day SLA are modelled on the general SDRF/NDRF input-subsidy structure but are **not verified Andhra Pradesh figures**. They live in one file (`server/rules.js`) so an officer can replace them with the current government order.

Telugu by default, English toggle for supervisors. Big touch targets, mobile-first layout.

## 3. Where AI helps and why

Principle: **the rule engine owns facts, money and eligibility; the LLM only explains and drafts; the officer decides.**

| Step | AI task | Why it genuinely helps |
|------|---------|------------------------|
| Docs | Summarise mismatches and what to ask the farmer, in simple Telugu | Officers read English-keyed portals but work in Telugu; saves cross-checking time |
| Inspection | Draft the formal inspection report from rough notes | Report-writing is the slowest part of field work; the officer edits before saving |
| Eligibility | Explain the calculation | Officers must justify amounts to farmers and auditors |
| Decision | Suggest approve/reject/return with reasons | Reasons are written into the record and shown to the farmer |

What AI does **not** do: calculate amounts, decide eligibility, or take any action. Those are plain code (`server/rules.js`) with unit tests, so they are auditable and reproducible.

**Graceful degradation:** with no `ANTHROPIC_API_KEY` (or if the API fails) the same endpoints return deterministic bilingual templates, so the workflow never blocks on AI. The UI labels each text as *Claude* or *Rules*.

## 4. How I would measure impact (and why I expect it to work)

| Metric | Baseline (to capture first) | Target | Source |
|--------|----------------------------|--------|--------|
| Median days from submission to decision | measure on paper/portal flow for one mandal for a month | −40% | `events` table timestamps |
| % applications decided within the 15-day SLA | baseline month | >90% | `events` |
| Returns caused by errors that could have been caught at step 1 (mismatch/duplicate) | baseline | −50% (caught earlier, once) | flags vs. later `returned` events |
| Officer time per application | time-and-motion on 20 cases | −30% | self-timing + event gaps |
| AI acceptance: % of AI suggestions followed, % of reports edited | n/a | monitor for blind trust (≈100% follow = red flag) | `decision.followed_ai`, `ai_assist` events |
| Wrong approvals / audit findings | audit sample | not higher than baseline | audit |

Why I expect it to work: delay comes mostly from **not knowing what is urgent** (fixed by the priority queue) and **errors found late** (fixed by checking at step 1 with rules, not at step 4). Both are solved by cheap, deterministic logic; AI only removes the writing and explaining overhead. A pilot in one mandal for one month, compared with the previous month, is enough to validate it. Everything needed to compute these metrics is already stored in the event log.

## 5. Main technical decisions

- **Node 24 + Express + built-in `node:sqlite`.** One small process, zero native dependencies, one file DB — trivial to deploy and to review. For a real rollout I would move to Postgres; the data-access code is isolated in `server/db.js`.
- **No front-end build step.** A small vanilla ES-module SPA (`public/`) keeps the bundle tiny for low-bandwidth phones and makes the code easy to read. State is a single object and rendering is pure functions.
- **Rules vs. AI split** (see §3). The LLM receives already-verified facts as JSON and is told it may not change numbers; output is validated as `{te, en}` JSON and falls back to templates on any failure.
- **Bilingual by construction.** The server returns flag messages in both languages; the UI string table lives in `public/i18n.js`. Telugu is default, copy kept in simple spoken register.
- **Roles.** AEO (field officer) completes steps 1–2 and may return a case; only the MAO can run steps 3–4, approve or reject. Enforced on the server (403), not just hidden in the UI.
- **Officer-in-control by design.** Server enforces step order, requires an explanatory note to proceed past high-severity flags, forbids approval of ineligible cases, and records `ai_recommended` vs. actual decision.
- **Auth:** scrypt-hashed passwords, random server-side session tokens in an `HttpOnly` cookie.
- **Priority score** (`priorityOf`): overdue > due ≤3 days > flagged > ready to decide.
- **Honest limits:** documents are modelled as extracted fields (name, survey no., last-4 digits) rather than uploaded scans/OCR; the damage-range check uses fixed plausible ranges as a stand-in for satellite/rainfall data; rates follow SDRF/NDRF-style norms simplified for the demo; no farmer-facing portal (the "farmer corrected it" step is a button). These are the first things I would build next.

## 6. Run it locally

Requires **Node ≥ 22.5** (built-in SQLite).

```bash
npm install
cp .env.example .env      # optional: add ANTHROPIC_API_KEY for Claude-written text
npm start                 # http://localhost:3000
```

Login with `mao` / `Rythu@2026`. The database is created and seeded with 12 sample applications on first start. Reset it any time with `npm run seed`.

```bash
npm test                  # unit tests (rules) + API integration tests (login, roles, full workflow, audit history)
```

With an API key: `ANTHROPIC_API_KEY=sk-ant-... npm start` (model via `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`).

### Deploy

A `Dockerfile` and `render.yaml` are included. On [Render](https://render.com): *New → Blueprint* → pick this repo, set `ANTHROPIC_API_KEY` (optional). The SQLite file lives in `/data`; the free tier is ephemeral, so data re-seeds on restart — fine for a demo, attach a disk for anything real.

### Project layout

```
server/  rules.js (business rules) · ai.js (LLM layer) · text.js (bilingual text)
         routes.js (REST API) · db.js · auth.js · seed.js · index.js
public/  index.html · app.js (SPA) · i18n.js (Telugu/English) · styles.css
test/    rules.test.js
```
