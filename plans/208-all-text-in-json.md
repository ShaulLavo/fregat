# Plan 208: All app text in JSON

Status: APPROVED 2026-09-29. Implementation has not started.

- [ ] Make English JSON catalogs the source of truth for all app-authored user-facing text
      across every client, site, CLI, shared package, Editor and ghostty-webgpu. Include
      accessibility text, settings, commands, notifications and error `message`/`why`/`fix`.
      Preserve user, agent, file and third-party content verbatim.
- [ ] Add stable semantic keys, typed keys and parameters, translator context, and whole-message
      interpolation/plurals through `packages/i18n`. Standalone packages ship their own catalogs.
- [ ] Resolve text in the consuming client's locale; transport errors as codes, message keys and
      parameters. Add a registry-backed display language, English fallback, locale-aware
      dates/numbers and RTL support. Keep machine identifiers stable.
- [ ] Automate extraction and caller migration; add a CI gate for hardcoded copy, missing/unused
      keys and invalid parameters. Every remaining literal needs a reviewed exclusion.
- [ ] Verify English behavior, plurals, fallback, language switching and expanded/RTL pseudo-locales
      across clients. Read back browser screenshots, pass gates, commit, push and deploy.
