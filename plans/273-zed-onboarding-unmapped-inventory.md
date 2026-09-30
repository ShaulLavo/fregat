# Plan 273: Retain Zed account onboarding actions as unmapped inventory

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-54; size S. Depends on Plan 206.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md` and `.json`, default translation
  `206-zed-translation.json`, and Zed `933d8d93819c749a607e561883855a9b95c79cea`. Preserve action identity and every payload variant.

## Outcome

Identify Zed-account onboarding shortcuts in Settings and continue authenticating each model provider through its own controls.

## Zed actions and behavior

`onboarding::Finish` closes the onboarding page, `onboarding::SignIn` authenticates the Zed
client, and `onboarding::OpenAccount` opens the user's zed.dev account page. These handlers
belong to the focused onboarding view and Zed user/client state. Source:
[`crates/onboarding/src/onboarding.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/onboarding/src/onboarding.rs) action declarations and view handlers.

`onboarding::Finish`, `onboarding::OpenAccount`, `onboarding::SignIn`.

## Existing Fregat and Editor work

`apps/web/src/features/settings/components/provider-section.tsx`, `apps/web/src/features/settings/components/provider-row.tsx`, and
`apps/web/src/features/settings/components/provider-values.tsx` own provider settings; `apps/web/src/features/settings/utils/provider-values.ts` supplies provider values.
`apps/web/src/features/settings/components/unmapped-shortcuts.tsx` and `apps/web/src/features/settings/components/keybinding-section.tsx` already render unmapped preset
rows. `apps/web/src/keymap/table.ts` owns executable commands. Fregat's provider authentication
has no Zed user/client onboarding object.

## Design

ZT-54 is an Excluded triage record. This Approved plan executes retention and verification of
those three names. Keep their original keys, contexts and payloads in Plan 206's unmapped
inventory with the reason "Requires Zed account onboarding". An unmapped record adds no
executable binding and no null suppression.

Keep the command table free of aliases from these actions to provider sign-in or Settings close.
Presets remain data and contexts retain source provenance. Existing provider sign-in mutations
keep their provider identity, capability checks and cache settlement. Editor work is unnecessary.

## Steps

- [ ] Add a failing inventory test for any omitted onboarding row or mapping to provider authentication.
- [ ] Retain all three names and source rows with their onboarding reason in the Plan 206 unmapped report.
- [ ] Add Settings coverage and a fixture-only provider-sign-in dispatch check.
- [ ] Run the inventory scenario and inspect screenshots.

## Acceptance

Focused preset tests retain all onboarding rows and prove they are unavailable for execution.
Run the keybinding-section tests. Add `zed-onboarding-inventory`: show all three reasons in
Settings, dispatch a supported provider sign-in command against a fixture adapter, and verify
its provider identity. Run `agent:browser scenario zed-onboarding-inventory` and `look`, read
the screenshots and record evidence. No real provider, CLI or account runs. Run gates, commit,
push and deploy.

## Out of scope

A Zed account, Zed onboarding screens, cloud billing/account links, and redesigning Fregat's
provider authentication. The triage exclusion is retained.
