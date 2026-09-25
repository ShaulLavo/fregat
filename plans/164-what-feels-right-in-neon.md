# Plan 164: What feels right in Neon

## Status and authorization

- Status: RESEARCH — study first. The owner, 2026-09-25: "I don't want to copy their thing, but
  something there feels really right and I want to use that."
- Priority: P2 in the UI refresh lane. It sharpens every other plan in the lane, so the study is
  worth doing before the bulk of 158–162 lands, but it blocks none of them.
- Effort: research S–M, then one executable plan per accepted quality.
- Planned at: Platform `9c1c45d1`, 2026-09-25. Background:
  [docs/ui-research/neon-ui.md](../docs/ui-research/neon-ui.md); source at `references/neon-ui`
  (MIT, Base UI and Tailwind v4, like ours).
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

We can say, in a sentence each, what makes Neon feel right. Each of those qualities is either a
rule in our design language or a token in `globals.css`, adopted because the owner saw it on our
own screens and agreed. Platform still looks like Platform. We take no Neon components, colours,
brand or token values wholesale; those are already covered by the steal lists in Plans 157, 158
and 160.

## Why a study and not a port

A feel is several small decisions acting together: type, spacing, contrast, where colour is
allowed, how things move, how copy is written. Copying Neon would import their answers to
questions our design language has already answered differently: no hairlines, four type sizes,
tone separation. What we want is the reason it feels right, restated in our terms.

## Research phase

1. **Ask the owner where it feels right.** Two or three Neon pages or components that carry the
   feeling. Everything below starts from those, not from the whole catalog.
2. **Put both apps side by side.** Run Neon's docs (`references/neon-ui`, `pnpm install && pnpm
dev`) and our dev server. Capture matched surfaces with `agent:browser`: a chat turn, a menu, a
   form, a list or table, a status row, an empty state, a dialog. Use both colour modes and both of
   our densities, and put the pairs in one evidence directory.
3. **Measure, don't describe.** A small script, run in both pages, dumps computed styles for the
   matched elements into one table:
   - type: family, size, weight, letter-spacing, line-height, numeral style
   - space: padding, gaps, row heights
   - shape: radius
   - tone: foreground, muted and background colours, and their contrast ratios
   - colour: how many hues are on screen
   - motion: durations and curves

   Numbers settle arguments that screenshots cannot.

4. **Name the qualities.** Each is one sentence plus the measurement that shows it. Hypotheses to
   test, not conclusions:
   - typographic restraint (mono as an accent, tabular numbers, small confident labels)
   - colour only in small marks, with words staying neutral
   - quieter surfaces with fewer tone steps
   - stricter alignment to a grid
   - receipt-style copy ("7 steps · 1 failed")
   - motion that settles rather than bounces
5. **Compare each quality with ours.** For each: what we do today, the gap, and the smallest rule
   or token change that closes it.
6. **Try before adopting.** For each candidate change, a dev-only token override (not a setting,
   not shipped) and a before/after `look` on the same surfaces. The owner picks from the pairs.
7. **Write it up** as `docs/ui-research/neon-feel.md`: the qualities, the measurements, the pairs
   and the owner's verdicts. Then this plan's research phase rewrites its own phases, or splits
   into executable plans.

## What adoption looks like

Each accepted quality lands as some mix of:

- a rule in `AGENTS.md` under The Design Language
- a token in `packages/ui/src/styles/globals.css`, and in the palette data where it is colour
- a `web-design-census.mjs` check where the rule is measurable
- a migration of existing call sites in the same pass, per the greenfield rule

## Open questions

- Which Neon pages carry the feeling? (Step 1 — the owner's answer drives the study.)
- If a quality conflicts with a settled rule (for example, Neon's hairline rails against our
  no-dividers rule), do we restate it through tone, or leave it out?
- Should the physical mode's Flat feel ([Plan 154](154-physical-mode.md)) be where Neon-like
  restraint lives, while Physical carries seamui's tactility?
