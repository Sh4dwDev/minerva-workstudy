# Minerva Connect

**A verified Q&A matching platform between Minerva University applicants and current students.**

Prospective students have real questions about academics, social life, and the application process. Minerva Connect lets them ask those questions and get authentic answers from current Minervans, matched by college, country, and topic, through a clean, brand-aligned web app.

> Note: As of June 2026, this is a student project and is **not officially affiliated with Minerva University**.

---

## What it does

**For applicants (no account needed):**
1. **Ask**: Submit a question through a short two-step form: intended college, topic, home country, your email, and the question itself (50 to 500 characters, with optional context).
2. **Get matched**: The question is routed to a relevant current student based on college, country, and topic.
3. **Connect**: A Minervan replies directly to your email, with minerva.connect@proton.me CC'd for safety and oversight.

**For current students (Minervans):**
1. **Log in** with your uni.minerva.edu email. No password, just a magic link (email OTP).
2. **Build a profile**: name, class (M27 to M30), college, home country, optional gender, used to match you with relevant applicants.
3. **Answer**: See your matched and open questions on a dashboard, reply by email, mark questions as answered, or start an in-app real-time conversation thread.

---

## The Minerva Approach (Guardrails)

This project is built to align with the **Minerva AI Guardrails** for staff and student projects:

1. **Human-Centered**: AI is a thinking partner, not a substitute. Humans remain the authors and decision-makers.
2. **Accountability**: A human is responsible for every line of code and every user experience. Computers cannot be held accountable for decisions.
3. **Data Privacy (Zero-Trust)**: The app deliberately minimizes the personal data it collects and avoids processing sensitive student PII.
4. **Radical Transparency**: AI assistance is disclosed in-app via a visible "AI-Assisted" badge in the footer.
5. **Official Branding**: Uses Minerva University's official color and typography standards (see below).

Full guardrails reference lives in [Guardrails Docs/](Guardrails%20Docs/).

---

## Brand Standards

The UI follows Minerva University's official Fall 2025 brand standards. The full guide is in [MU Branding Guidelines/](MU%20Branding%20Guidelines/). The palette is defined as CSS variables in [css/styles.css](css/styles.css):

| Role | Token | Hex |
| :--- | :--- | :--- |
| Primary / ink | `--mu-obsidian` | `#000000` |
| Background | `--mu-bone` | `#f0ebe6` |
| Surface | `--mu-ivory` | `#f2f2f2` |
| Accent (links/buttons) | `--mu-clay` | `#905112` |
| Highlight | `--mu-goldenrod` | `#f0b91e` |
| Highlight | `--mu-tangerine` | `#f0871e` |
| Neutrals | `--mu-charcoal`, `--mu-slate`, `--mu-graphite`, `--mu-ash` | n/a |

**Typography:** serif for headings, sans-serif for body. **Accessibility:** designed for WCAG AA contrast and responsive layouts. Please keep contributions within these standards.

---

## Tech Stack

- **Frontend**: Vanilla HTML5, CSS3, and JavaScript modules. No frameworks, no build step.
- **Backend**: [Supabase](https://supabase.com). Postgres database, email-OTP auth, and realtime subscriptions (loaded via CDN).
- **Hosting**: GitHub Pages (static, no cost).
- **Philosophy**: Clarity over cleverness. Accessible and responsive by default.

### Project structure
```
index.html              app shell (all views/sections)
css/styles.css          Minerva brand styling
js/app.js               all app logic (auth, forms, dashboard, chat)
js/jsconfig.js          Supabase URL + public anon key
js/countries.js         country dropdown data
Guardrails Docs/        Minerva AI guardrails reference
MU Branding Guidelines/ official brand standards guide
```

### Data model (Supabase tables)
- `profiles`: one row per signed-in Minervan (name, class, college, country, gender).
- `questions`: applicant submissions (topic, target college, country, content, context, email, status).
- `threads`: a conversation linking a Minervan to a question.
- `messages`: realtime chat messages within a thread.

---

## Running it locally

It's a static site, no install needed. Clone and serve the folder:

```bash
git clone https://github.com/emmanuelangelo-hyuwa-lang/minerva-workstudy.git
cd minerva-workstudy
python3 -m http.server 8000
```

Then open http://localhost:8000. The Supabase connection is already configured in [js/jsconfig.js](js/jsconfig.js).

> **Why is the Supabase key in the repo?** The `SUPABASE_ANON_KEY` is a *public* key. It is designed to ship in browser code, so committing it is expected and safe. Data is protected by Row Level Security policies on the database, not by hiding the key.

---

## License and Usage Rights

**THIS PROJECT IS NOT LICENSED. NO LICENSE IS GRANTED.**

**This repository is provided WITHOUT any open-source or other license. All rights are reserved by the author, Emmanuel Angelo-Hyuwa, under applicable copyright law. The absence of a license means that you are NOT granted any rights to use this work. By default, you may NOT reproduce, copy, fork, clone, mirror, download, host, redistribute, sublicense, modify, adapt, translate, publicly display, publicly perform, create derivative works from, or otherwise exploit any part or the whole of this project, in any form or medium, whether for commercial or non-commercial purposes.**

**If you wish to use any portion or the entirety of this project, including but not limited to its source code, design, content, or assets, you MUST first obtain the author's prior written permission. To request permission, email minerva.connect@proton.me with the exact subject line:**

> **`[URGENT] - Request for Reproduction`**

**Your request must clearly describe (1) which parts of the project you intend to use, (2) the purpose and context of the intended use, and (3) where and how it will be distributed or displayed. No rights are granted unless and until you receive explicit written authorization from the author. Unauthorized use constitutes copyright infringement and may be subject to legal action.**

**Limited exception for contributors:** solely for the purpose of contributing changes back to this repository via a pull request, you are permitted to fork and clone this repository. This limited permission does not grant any right to use the project for any other purpose. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Contributing

Contributions are welcome. Please read **[CONTRIBUTING.md](CONTRIBUTING.md)** before opening a pull request. It covers setup and the brand and guardrails standards your changes should follow.
