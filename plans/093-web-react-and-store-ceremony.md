# Collapse repeated React and store ceremony in apps/web

Status: **DONE except one owner question** (completion wave, lane L6, 2026-09-25). Landed on
`lane/L6`: CONTEXT_MISSING at the missing-provider guards, `syncRemote`'s log context,
`lib/require-context.ts` at every guard, `lib/store-context.ts` (generic over the store API), the
settings stores on zustand, `use-deferred-commit-field`, the index/remote git mutation factories,
one git fixture runner per runtime (identity through vitest `test.env`), and 7.2b–e, g. Decisions
took the written recommendations (Decided 2026-09-25: recommendation (completion wave)); 5.5's
FontWidget rename is obsolete, because FontWidget is now a picker with no draft, like the other
pickers that use `onChange`.

## Owner questions

- **5.1 — does `EditorColorThemeContext` keep an `undefined` default for good?** If yes,
  `lib/editor-theme/hooks/use-editor-color-theme.ts` moves onto `requireContext`, which already
  treats `undefined` as missing. If it may become `null`, the file keeps its explicit test. Until
  answered it stays outside the sweep.

Delete this file once the question is answered and applied.
