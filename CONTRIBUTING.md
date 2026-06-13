# Contributing to Minerva Connect

Thanks for helping out. **I hope you read this all the way through.** It's short, and it'll save us both time on the pull request. Before anything else, please skim the [README](README.md) so you understand what the project does and the values behind it.

## A note from the maintainer

Hi, I'm Emmanuel, an incoming second-year student at Minerva University, and this is the first repository I'm managing on my own. If you have even a little bit of experience, please feel free to reach out and help out. Most of the issues here (if not all) are beginner-level, so this is a friendly, low-pressure open-source project to practice on and learn with. I appreciate the patience and the help.

## A note on usage rights

This project is **not licensed for general reuse** (see the License and Usage Rights section in the [README](README.md)). To be clear: you are permitted to fork and clone this repository **for the sole purpose of contributing changes back to this project via a pull request**. Any other use requires the author's prior written permission as described in the README.

## What this project is

Minerva Connect matches Minerva University applicants with current students for verified Q&A. It's a vanilla HTML, CSS, and JavaScript static site backed by [Supabase](https://supabase.com). See the [README](README.md) for the full picture.

## Setup

1. **Fork and clone** this repository (for contribution purposes, per the note above).

2. **Run the app.** It's a static site that talks to a shared Supabase backend. The connection details are already in `js/jsconfig.js`, so there's nothing to configure. Just serve the folder:
   ```bash
   python3 -m http.server 8000
   ```
   Open http://localhost:8000.

That's it. You're connected to the same database the live app uses.

> **Note on the Supabase key:** the `SUPABASE_ANON_KEY` in `js/jsconfig.js` is a *public* key. It's meant to ship in browser code, so committing it is expected and safe. Data is protected by Row Level Security policies on the database, not by hiding the key. **Please don't commit any other secrets** (`.env` files, service keys, and similar). Those are gitignored for a reason.

## Brand and guardrails standards (please follow these)

This is a Minerva-aligned project, so contributions need to respect two things:

**Brand standards**: the official Minerva Fall 2025 look. The full guide is in [MU Branding Guidelines/](MU%20Branding%20Guidelines/), and the palette is defined as CSS variables in [css/styles.css](css/styles.css). When you add or change UI:
- Use the existing `--mu-*` color tokens (such as `--mu-obsidian`, `--mu-bone`, `--mu-clay`). Don't hardcode new hex values.
- Keep serif for headings, sans-serif for body.
- Maintain WCAG AA contrast and responsive layouts.

**AI Guardrails**: see [Guardrails Docs/](Guardrails%20Docs/). In short: keep humans accountable, minimize the personal data we collect (no sensitive PII), and preserve the in-app "AI-Assisted" disclosure. If your change uses AI features, disclose it.

## Making changes

- Branch off `main`, make your change, and test it locally against the shared backend.
- Keep changes consistent with the brand and guardrails above.
- Open a pull request describing **what** you changed and **how** you tested it.

## Questions?

Open an issue. I'm happy to help you get unstuck. Thanks again for reading, and welcome aboard.
