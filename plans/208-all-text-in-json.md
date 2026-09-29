# Plan 208: All app text in JSON

Status: APPROVED 2026-09-29. Implementation has not started.

Decision: [Paraglide JS](https://paraglidejs.com/) (`@inlang/paraglide-js`) with
[inlang's JSON message format](https://inlang.com/m/reootnfj/plugin-inlang-messageFormat).

- [ ] Make English JSON catalogs the source of truth for all app-authored user-facing text
      across every client, site, CLI, shared package, Editor and ghostty-webgpu. Include
      accessibility text, settings, commands, notifications and error `message`/`why`/`fix`.
      Preserve user, agent, file and third-party content verbatim.
- [ ] Keep the shared inlang project and JSON catalogs in `packages/i18n`; compile Paraglide's
      typed `m.*` functions [per JS consumer](https://paraglidejs.com/monorepo) with Vite or CLI.
      Use flat semantic keys, translator context and whole-message interpolation/plurals.
      Standalone packages ship their catalogs; native clients consume the format through an adapter.
- [ ] Resolve text in the consuming client's locale; transport errors as codes, message keys and
      parameters. Add a registry-backed display language, English fallback, locale-aware
      dates/numbers and RTL support. Keep machine identifiers stable.
- [ ] Automate extraction and caller migration; add a CI gate for hardcoded copy, missing/unused
      keys and invalid parameters. Every remaining literal needs a reviewed exclusion.
- [ ] Verify English behavior, plurals, fallback, language switching and expanded/RTL pseudo-locales
      across clients. Read back browser screenshots, pass gates, commit, push and deploy.
