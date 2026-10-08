# Release cycles, changelogs and issue intake

Research for [Plan 336](../../../plans/336-packages-as-products.md), Track A item 4, feeding Track G
(release cycle) and the issue-intake parts of Track C. Written 2026-10-08 against Fregat `0df5eb872`.

Sources were read on 2026-10-08: project policy pages, `CONTRIBUTING.md` files, `.changeset/config.json`
files, release workflows and recent GitHub Releases, fetched through `gh api` and the web. Where a
statement comes from memory instead of a source read today, it says "unverified".

## Where we are today

Facts from this checkout and GitHub, not opinions:

- **Changesets 3.0.3** with three fixed groups (`.changeset/config.json`): 21 `@singapore-editor/*`
  packages, the two hotkeys packages, and `ghostty-webgpu`. Changelog generator is the default
  `@changesets/cli/changelog`, so entries carry a bare commit hash and no PR link.
- **Version PRs merge but nothing publishes.** 21 "Version public packages" PRs merged between
  2026-09-26 and 2026-10-06 (#881 is open now). The repository says `@singapore-editor/core` 0.2.6 and
  `ghostty-webgpu` 0.3.20, while npm `latest` for both is 0.1.2 (published 2026-09-28), and
  `@fregat/hotkeys` is not on npm at all. The publish job in `.github/workflows/release.yml` is gated on
  the `NPM_TRUSTED_PUBLISHING` repository variable, which is not set. Every version between 0.1.2 and
  today exists only in git and in `CHANGELOG.md`.
- **One provenance blocker.** `ghostty-webgpu/package.json` has
  `repository.url = git+https://github.com/ShaulLavo/ghostty-webgpu.git` (the mirror), but the publish
  runs in `ShaulLavo/fregat`. npm trusted publishing requires `repository.url` to match the publishing
  repository exactly ([npm docs](https://docs.npmjs.com/trusted-publishers)). The Singapore and
  hotkeys packages already point at fregat with a `directory`. Its `homepage` and `bugs` also point at
  the mirror.
- **npm CLI 11.19.0** is installed for publishing. Trusted publishing needs 11.5.1+; changing
  dist-tags through OIDC (`npm dist-tag add` for promoting a `next` build) needs 11.21.0+.
- **Changelog entries describe the implementation.** Current pending entries include "Release each
  worker WebGPU device once and wait for pending acquisition and recovery cleanup before confirming
  disposal" and "Add agent-facing autonomous performance research instructions". Every fixed-group
  release also adds a line such as `- @singapore-editor/textbuffer@0.2.6` to each of the 21 changelogs.
- **One GitHub Release exists** in fregat: `hotkeys-0.0.2-68d8aaf6f631-260650623e7e`, a pre-release
  whose body lists commit SHAs, PR numbers, test counts and a SHA-256. That is review evidence; nobody
  outside the project can use it as release notes.
- **Mirrors have no tags or Releases.** `singapore`, `ghostty-webgpu` and `hotkeys` each have 0 tags,
  Issues on, Discussions off. Fregat has Issues on, Discussions off, and GitHub's default labels plus
  `unconfirmed`, `in progress` and `engine-investigation`.
- **Owner rules in force:** patch bumps only until launch, breaking changes included; strict semver
  from launch. Agents no longer open issues. After launch, outside users use the tracker.

## 1. Patterns, ranked

Ranked by how much each would improve what a user of our packages sees, weighed against effort.

1. **Changelog entries written for the person upgrading, and enforced.** The single largest gap.
   Zed, Biome and Astro all publish rules for writing entries: say what the user sees or can now do,
   name the setting/API/keybinding, one to three sentences, link the PR, technical detail goes in the PR
   body. Zed's rule is the sharpest: "A Release Notes line should only be written if the user can see or
   feel the difference." Biome adds tense rules ("Fixed …", "Added …"; present tense for current
   behavior) and code samples for behavior changes.
2. **Publish what you version.** Every project studied publishes the moment a version exists. Version
   numbers that never reach npm break `CHANGELOG.md` as a record (users read about 0.3.17 and can only
   install 0.1.2). Turn on trusted publishing before anything else in Track G.
3. **A stable channel plus a continuous pre-release channel.** React (`latest`, `canary`,
   `experimental`), Deno (`stable`, `rc`, `canary`, `lts`), Bun (`bun upgrade --canary`), xterm.js
   (`xterm@beta` from every master commit, unverified for 2026), Ghostty (`tip`), Zed (stable, preview,
   nightly). The pre-release channel lets early users and our own apps test unreleased work without
   waiting for a release, and it carries no semver promise.
4. **Per-PR preview packages** without touching npm: Vite (label `trigger: preview`), TanStack (every
   PR) and Astro (label `pr preview`) publish to [pkg.pr.new](https://github.com/stackblitz-labs/pkg.pr.new)
   or a `--snapshot` npm tag, and the bot comments install commands on the PR.
5. **Grouped release notes with a human summary on top.** pnpm opens each GitHub Release with a
   two-sentence summary before the generated list. Zed groups by area (AI, Git, Languages, Bug Fixes).
   Ghostty's minors are hand-written pages: highlights with screenshots and video, breaking changes,
   full changelog grouped by area, roadmap. CodeMirror groups every entry under "Breaking changes",
   "Bug fixes", "New features" and links API names to the reference.
6. **A written versioning policy that says what counts as breaking.** React (warnings and
   `unstable_` APIs are not breaking), Biome (formatter output changes are patch; config-driven
   behavior and public API changes are major), Vite (TypeScript types may break in minors). Each turns
   "is this a minor?" into a lookup.
7. **Deprecate in a minor, remove in the next major, with a migration guide.** Vite states it exactly;
   React adds dev warnings first so a warning-free app upgrades cleanly; xterm.js marks breaking items
   inline with a warning sign in the release notes.
8. **One GitHub Release per product family, not per package.** TanStack Query publishes ~20 packages
   in one fixed group and writes one GitHub Release per publish with its own script
   (`scripts/create-github-release.mjs`). Astro and Effect use the `changesets/action` default of one
   Release per package; Effect's 4.0.2 produced dozens of identical-version Releases on one day.
9. **Mirrors carry tags and Releases, never issues or PRs.** Symfony's and Laravel's subtree-split
   repositories (`symfony/http-foundation`, `illuminate/support`) have Issues off, get a tag and a
   GitHub Release per version, and a bot closes every PR with a pointer to the main repository.
10. **Release blog posts for minors and majors only.** Bun (one post per release, with benchmarks and
    contributor counts), Vite (a post per minor and major), Ghostty (release-notes pages on the docs
    site), React and Deno (posts for majors and notable minors). Patches get a GitHub Release only.
11. **LTS** only where enterprises pin: Deno 2.x LTS lines last 3 to 6 months; Vite supports the
    previous minor and previous major with security fixes. Not needed for us until there are users who
    ask.

## 2. Per-project notes

### Vite

- **Channels:** stable, plus alpha (majors) and beta (minors and majors). "Do not use pre-releases in
  production." Experimental features ship in stable behind flags and may change in minors.
- **Cadence:** "no fixed release cycle." Patches "as needed (usually every week)"; minors about every
  two months, always through a beta; majors about yearly, aligned with Node.js EOL.
- **Version policy:** semver, with TypeScript types allowed to break in minors. Support tiers: current
  minor gets patches; previous minor and previous major get important fixes and security; one older of
  each gets security only.
- **Changelog:** generated from Conventional Commit titles (`fix(html): …`) into
  `packages/vite/CHANGELOG.md`, grouped "Bug Fixes", "Performance Improvements", "Features", each with
  PR and commit link. Readable because PR titles are enforced (`semantic-pull-request.yml`), but the
  wording is still the commit subject.
- **Releases and posts:** GitHub Release per version, body is the changelog section. Blog post per
  minor and major on vite.dev; a Migration Guide per major lists every removal.
- **Deprecation:** in a minor, with a type or runtime warning; removed in the next major.
- **Automation:** custom `prepare-release.yml` and `publish.yml` (tag-triggered), `preview-release.yml`
  with pkg.pr.new behind the `trigger: preview` label. `vite-ecosystem-ci` runs downstream frameworks
  against a release before it ships.
- **Intake:** issue forms with required reproduction link, `envinfo` output, package manager dropdown
  and a checklist; `blank_issues_enabled: false`; contact links to plugin repositories, Discord and
  Discussions. New bugs get `pending triage`. Adding `needs reproduction` posts a comment; a nightly job
  closes those after 3 inactive days (`issue-close-require.yml`). A daily job locks closed issues.

### Astro

- **Changesets** with `@changesets/changelog-github`. Every user-visible change has a changeset;
  examples need none. A bot ("astro-factory") writes many of their PRs and changesets today.
- **Changelog style:** "Fixes …" / "Adds …", present tense, one or two sentences, then the corrected
  behavior: "Fixes `astro add cloudflare` failing to install dependencies with pnpm v11+ … and shows the
  package manager's error output when `astro add` fails". Code samples for new APIs.
- **Pre-release mode:** `changeset pre enter next` plus `baseBranch: next` publishes under the `next`
  dist-tag for betas of a major; exit with `changeset pre exit`. A `latest` patch during pre mode is
  manual from a `release/0.X` branch.
- **Previews:** label `pr preview` publishes a preview version of each package with a pending
  changeset (`preview-release.yml`, OIDC `id-token: write`, cache disabled so a poisoned cache cannot
  reach the publish step).
- **Releases:** one GitHub Release per package (`astro@7.3.7`, `@astrojs/node@11.1.7`). Majors and
  notable minors get a blog post and an upgrade guide in the docs.
- **Intake:** one bug form; `issue-needs-repro.yml` and `issue-wontfix.yml` automations; Discussions
  off (support lives on Discord).

### TanStack (Query, Router)

- **Changesets**, `@changesets/changelog-github` with `disableThanks: true`, one fixed group per
  library (~20 packages for Query).
- **Branches as channels** (`release.yml`): `main` publishes `latest`; `*-pre` branches publish as
  prerelease (changesets pre mode); `*-maint` publishes under `maint`; `vN` branches publish under
  `vN` for old majors.
- **GitHub Release:** one per publish, built by `scripts/create-github-release.mjs` from the bumped
  package versions and the commit log since the previous version commit.
- **Previews:** every PR publishes all packages to pkg.pr.new (`pkg-pr-new publish --compact`), plus a
  "Changeset Preview" job that comments the versions the PR would produce.
- **Intake:** one bug form, Discussions on for questions and ideas.

### React

- **Channels:** `latest` (semver), `canary` (`19.3.0-canary-<hash>-<date>`, tracks main, "a superset
  of Latest that is updated more frequently", no semver, supported for frameworks that pin it) and
  `experimental` (`0.0.0-experimental-<hash>-<date>`, extra flags, no stability). "If you're not sure
  which channel you should use, it's Latest."
- **Policy:** patches only for critical bugs and security; minors are the common release; majors are
  rare. Development warnings, `unstable_` APIs, canary builds and internals are not breaking changes.
  "If your app has no warnings on the latest release, it will be compatible with the next major."
- **Upgrade path:** codemods and upgrade guides per major; security fixes backported to every
  affected major. Library authors are told to run CI on a cron against `@canary`.
- **Changelog:** hand-written `CHANGELOG.md` per release, grouped by package (React, React DOM, Server
  Components), each line a user-visible behavior with PR link.

### Biome

- **Changesets** with `@changesets/changelog-github`; one fixed group (CLI plus platform binaries and
  wasm builds).
- **Writing rules** (`CONTRIBUTING.md`): only user-facing changes; "between 1 and 3 sentences"; longer
  means "pay attention"; past tense for what changed ("Fixed …", "Added …"), present tense for current
  behavior ("Biome now supports …"); bug fixes start with the issue link, "Fixed [#4444](…): …"; new
  rules link their docs page; behavior changes show an example (a `diff` block for formatter changes);
  headings inside a changeset only `####` or `#####`; end sentences with a period.
- **Version policy** ([biomejs.dev/internals/versioning](https://biomejs.dev/internals/versioning/)):
  a published table of what is patch, minor and major for a toolchain. Users are told to pin exact
  versions because even patches can change output.
- **Branches:** fixes to `main`; user-facing features and rule promotions to `next`; minors and majors
  ship by merging `next` into `main`. Odd minors are pre-releases, even minors stable (also how the
  VS Code extension marks previews, since the marketplace has no pre-release tag).
- **Cadence:** weekly-ish patches (2.5.11 to 2.5.15 over five weeks).
- **Intake:** six forms, split by area (formatter bug, lint bug, other bug, task, umbrella, commercial
  request). Prefixed labels: `S-` status (`S-Needs triage`, `S-Needs repro`, `S-Bug-confirmed`,
  `S-Needs response`), `A-` area (`A-Linter`, `A-Formatter`, `A-LSP`), `L-` language. `needs-repro.yml`
  and `close-issue.yml` automate follow-ups.

### Bun

- **Channels:** stable and canary (`bun upgrade --canary`, a build from every main commit).
- **Release posts:** every release, patches included, gets a post at `bun.com/blog/bun-v1.x.y`:
  headline features with benchmark charts and code, then "Bugfixes" by area, a contributor count and the
  install/upgrade command. GitHub Releases link the post. No `CHANGELOG.md`.
- **Cadence:** irregular; 1.3.13 to 1.3.14 took three weeks, 1.4.0 to 1.4.2 two weeks.

### Ghostty

- **Channels:** stable and `tip` (continuous builds from main, a moving GitHub Release; the macOS app
  has a tip update channel).
- **Cadence:** minors every six to eight months (1.1.0 Jan 2025, 1.2.0 Sep 2025, 1.3.0 Mar 2026),
  patches days to weeks after. The 1.3.0 page states the next minor's target month in its roadmap.
- **Release notes:** a page per version on ghostty.org (`/docs/install/release-notes/1-3-0`), written
  by hand. 1.3.0 opens with a two-paragraph summary and the scale ("6 months of work with changes from
  180 contributors over 2,858 commits"), then: Security, Highlights (each with screenshots or video and
  linked PRs), System Requirements, Breaking Changes, Full Changelog grouped by area (Terminal
  Capabilities, Shell Integration, macOS, GTK, Localization, Changes for Package Maintainers),
  Libghostty, Financial Update, Roadmap. An index page lists every version with its date.
- **Intake, the strictest studied:** users do not open issues. Bugs go to a Discussions category
  "Issue Triage" with its own template; maintainers convert actionable ones into issues, so "all issues
  are actionable". First-time contributors must be vouched in a "Vouch Request" discussion before PRs
  are accepted ("AI has unfortunately made it so we can no longer trust-by-default"); unvouched PRs
  close automatically.

### xterm.js

- **Packages:** `@xterm/xterm` plus about a dozen `@xterm/addon-*` packages, versioned independently.
- **Channels:** stable and `beta` published from master (unverified for 2026).
- **Cadence:** slow. 5.5.0 (Apr 2024) to 6.0.0 (Dec 2025).
- **Release notes:** hand-curated GitHub Release: "Features", "Fixes", per-PR lines (`#5453 Add
synchronized output support (DEC mode 2026)`), breaking changes flagged inline with ":warning: This is
  a breaking change, …" plus how to adapt. Lines are often raw PR titles ("fix #5181").
- **Intake:** Markdown templates (bug, feature), Discussions on.

### CodeMirror

- **Many packages, independent versions** (`@codemirror/view` 6.41.0, `@codemirror/state`, …), all on
  major 6 since 2022. No fixed group: a package releases only when it changed.
- **Changelog from commit messages:** the release script (`codemirror/dev` `bin/cm.js`) scans commits
  since the last version for paragraphs starting `FIX:`, `FEATURE:` or `BREAKING:`, computes the bump
  from them (any `BREAKING` is major, any `FEATURE` minor, else patch), and writes
  `## 6.41.0 (2026-04-01)` with "Breaking changes", "Bug fixes", "New features" sections. API names in
  entries link to the reference (`](##` is rewritten to `codemirror.net/docs/ref/#`).
- **Style:** one or two plain sentences per entry, written by the maintainer for the user: "Fix an
  issue where `EditorView.posAtCoords` could incorrectly return a position near a higher element on the
  line, in mixed-font-size lines." "The new `EditorView.cursorScrollMargin` facet can now be used to
  configure the extra space used when scrolling the cursor into view."
- **Releases:** a git tag per package version with the notes in the tag message; no GitHub Releases;
  a combined changelog page on codemirror.net. The model for Singapore's tone.

### Deno

- **Channels:** stable, `rc` (candidate for the next minor), `canary` (several builds a day), `lts`,
  and `alpha`/`beta` during majors. `deno upgrade lts|rc|canary` switches channel; the binary knows its
  channel.
- **Cadence:** a minor every 12 weeks, patches "as needed" in between.
- **LTS:** one minor line gets backported security and critical fixes for 3 to 6 months (2.9 until
  2027-01-31). "API changes and major new features will not be backported."
- **Unstable APIs** need explicit `--unstable-*` flags, so they never count against semver.
- **Automation:** release workflows written in TypeScript and generated to YAML (`start_release`,
  `version_bump`, `promote_to_release`). Blog post per minor.

### Tauri

- **covector** instead of Changesets. Change files in `.changes/*.md` carry a bump and a category in
  frontmatter: `'tauri': 'patch:bug'`. Categories are configured in `.changes/config.json`: New
  Features, Enhancements, Bug Fixes, Performance Improvements, What's Changed, Security fixes,
  Dependencies, Breaking Changes. The changelog is grouped by those headings. `check-change-tags.yml`
  rejects unknown tags.
- **Releases:** one GitHub Release per package (Rust crates and npm packages), currently in a 3.0
  alpha. Blog post per major and minor.

### pnpm

- **Changesets** with hand-edited GitHub Releases. Each Release opens with a short summary ("This
  release adds an experimental `loaded` node linker, lets `pnpm-lock.yaml` record resolution settings,
  and reads cached registry metadata faster. It also carries several security fixes …"), then "Minor
  Changes" and "Patch Changes", with patch changes sub-grouped by area (Security; Installing and
  resolving dependencies). Entries are full user-facing sentences with issue links.
- **Two supported majors** at once (12.10.x and 11.28.x released the same day).
- **Intake:** bug form, separate regression form, `triage-issues.yml`.

### Effect

- **Changesets**, `@changesets/changelog-github`, one large fixed group (`effect` plus every
  `@effect/*` package). Default `changesets/action` Releases: one per package per version, so a single
  4.0.2 publish produced dozens of Releases on 2026-10-07. A clear example of what not to copy.
- Branch list shows agent-authored branches (`agent/bob/…`, `agent/effect-bot/…`), so another project
  writes much of its code with agents and still ships changesets. Their entries' quality was not
  reviewed here.

### Zed

- **Channels:** stable, preview, nightly. Weekly: every Wednesday the current preview becomes stable and
  main becomes the new preview (`v1.23.2` stable and `v1.24.1-pre` released within a minute of each
  other on 2026-10-07). Hotfixes are cherry-picked into both.
- **Release notes come from PR bodies.** The PR template ends with `Release Notes:` followed by
  `- N/A or Added/Fixed/Improved ...`. A script collects those lines for the week's PRs. Rules
  (`docs/src/development/release-notes.md`): write a line only "if the user can see or feel the
  difference"; phrase it so a user understands it ("Don't assume a user knows technical editor
  developer lingo"); technical detail goes above the line; always name the setting or keybinding;
  reverted shipped items get a line explaining the revert.
- **Release format:** a one-sentence lead ("This week's release includes the ability to preview JSONL
  and NDJSON files as tables."), then "Features" grouped by area (AI, Git, Languages, Remote Development,
  Other) and "Bug Fixes"; each line ends with the PR link and a thank-you for outside contributors.
- **Intake:** two forms (bug, crash); `blank_issues_enabled: false`; feature requests go to a
  Discussions category. Labels prefixed `area:`, `state:`, `priority:`, `frequency:`. Many bots:
  duplicate-candidate comments, stale PR reminders, first-responder notifications, good-first-issue
  notifier.

### Mirrored repositories (Symfony, Laravel)

- `symfony/http-foundation` and `illuminate/support` are read-only subtree splits of a monorepo.
  Issues off, Discussions off. Each gets a tag per version (`v8.1.8`) and a GitHub Release whose body is
  the component's changelog with a compare link.
- Laravel's splits run one workflow, `close-pull-request.yml`, which closes every PR with a comment:
  "… a read-only sub split of `laravel/framework`. Please submit your PR on the
  https://github.com/laravel/framework repository." The About text starts "[READ ONLY] Subtree split of
  …".

### npm trusted publishing (applies to all of the above)

- OIDC from GitHub-hosted runners only; `id-token: write`; npm CLI 11.5.1+ and Node 22.14+;
  `repository.url` must match the publishing repository. Provenance is attached automatically for public
  packages from public repositories.
- Up to 10 trusted publishers per package; workflow filename only (`release.yml`); optional
  environment name. A new configuration must publish within 2 days or it expires.
- After trusted publishing works, set each package to "Require two-factor authentication and disallow
  tokens" so a leaked token cannot publish.

## 3. Proposal for our release cycle

### Pre-launch (now until the owner declares launch)

Version policy stays as the owner set it: every changeset is `patch`, breaking changes included.
Packages stay on `0.x`. Users who install a pre-launch version are told in each README that any patch
may break their code and that they should pin exact versions (Biome's advice for its own patches).

Channels:

| Channel    | npm dist-tag          | Version                             | Built from                              | Who it is for                                               |
| ---------- | --------------------- | ----------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| Stable     | `latest`              | `0.3.21`                            | Version PR merge                        | Anyone trying the package                                   |
| Next       | `next`                | `0.3.21-next.20261008T1412.0df5eb8` | Every main push with pending changesets | Fregat itself, early adopters, bug reporters checking a fix |
| PR preview | none (pkg.pr.new URL) | commit SHA                          | A PR with the `preview` label           | Reviewers and reporters testing one fix                     |

Cadence: **one stable release a week**, on a fixed day (Tuesday, so it does not collide with the
weekend merge trains). Today the version PR merges several times a day and nothing publishes; batching
gives each release enough content to read, and `next` covers anyone who needs a fix sooner. A
critical fix (crash, data loss, security) may release the same day.

Concrete steps, in order:

1. Fix `ghostty-webgpu/package.json`: `repository` to `git+https://github.com/ShaulLavo/fregat.git`
   with `"directory": "ghostty-webgpu"`, and `homepage`/`bugs` to the fregat-hosted URLs Track C
   chooses. Without this, trusted publishing fails or produces mismatched provenance.
2. Owner configures npm trusted publishers for all 24 packages (`ShaulLavo/fregat`, `release.yml`) and
   sets `NPM_TRUSTED_PUBLISHING=true`. Then set "disallow tokens" on each package. Bump the pinned npm
   CLI to 11.21.0 or newer so dist-tag changes also work over OIDC.
3. The first publish ships the current versions (Singapore 0.2.x, ghostty-webgpu 0.3.x, hotkeys
   0.0.x). Do not renumber; the burned numbers are harmless.
4. Switch the changelog generator (below), add the `next` snapshot job and the family GitHub Releases.
5. Stop merging the version PR on every push: merge it once a week. A PR check is enough to enforce
   this socially; no automation needed.

### Post-launch (from the owner's launch decision)

- **Launch version: `1.0.0` for each family** (Singapore, ghostty-webgpu, hotkeys). On `0.x`, npm's
  caret ranges treat a minor as breaking (`^0.3.0` never installs `0.4.0`), so "minors for features"
  only means something to users from 1.0. The owner decides; this is the recommendation.
- **Strict semver** from 1.0.0, with a written policy in `docs/releasing.md`:
  - Patch: bug fixes, performance work, docs, and visual changes that do not change an API.
  - Minor: new APIs, options, renderers, languages, events; deprecations; a new default that users can
    switch back with an option.
  - Major: removed or renamed exports, changed signatures or event payloads, removed options, raised
    minimum browser or runtime versions.
  - Not breaking (React's list, adapted): anything marked `@experimental` or exported under an
    `unstable_` prefix, `next` and preview builds, undocumented internals, dev-only console warnings,
    benchmark tooling.
  - TypeScript types may tighten in a minor when they were wrong (Vite's rule).
- **Channels:** `latest`, `next` (continues unchanged), PR previews, and **beta through Changesets
  pre mode** for a major only: `changeset pre enter beta` on a `<family>-v2-pre` branch, published under
  the `beta` tag (TanStack's branch-name-to-tag pattern). No LTS line until a user asks for one; at
  most, the previous major gets security fixes for six months (Vite's tier).
- **Cadence:** patches weekly (unchanged). Minors when a feature set is ready, at most every four
  weeks and at least once a quarter while there is new work, each with a release post. Majors at most
  yearly per family, announced one minor in advance through deprecations.
- **Deprecation:** deprecate in a minor with a `@deprecated` JSDoc tag naming the replacement and a
  one-time dev console warning; remove in the next major; every removal appears in that major's
  migration guide. ghostty-webgpu's xterm.js compatibility surface follows the same rule.
- **Migration guides** live on each docs site (`/guides/migrating-to-v2/`), are written before the
  beta, and are linked from the major's GitHub Release and post. The xterm.js migration guide in Track F
  is the first instance.
- **Release posts** for every minor and major, on each product's site (Ghostty's page structure, Bun's
  benchmark charts where performance moved). Patches get a GitHub Release and the changelog page only.
- **Release announcement at launch** (Plan 336 Track G item 5): one post per family plus one for
  Fregat, published together.

### Changelog generator configuration

Use `@changesets/changelog-github` through a thin local wrapper so the fixed groups stop producing noise.

`.changeset/config.json`:

```json
{
  "changelog": ["./changelog.cjs", { "repo": "ShaulLavo/fregat" }],
  "snapshot": {
    "useCalculatedVersion": true,
    "prereleaseTemplate": "next.{datetime}.{commit}"
  }
}
```

(other keys unchanged)

`.changeset/changelog.cjs`, about 20 lines:

- `getReleaseLine`: delegate to `@changesets/changelog-github` with `disableThanks: true` (every author
  today is the owner or an agent; TanStack does the same). Keep the PR link, drop the bare commit hash
  when a PR link exists. After launch, turn thanks back on for authors outside the owner's account.
- `getDependencyReleaseLine`: return `""` when every updated dependency is in the same fixed group,
  removing the 21 `- @singapore-editor/textbuffer@0.2.6` lines per release. Keep the line for
  cross-family bumps (ghostty-webgpu picking up a new hotkeys).

The `version` job in `release.yml` must pass `GITHUB_TOKEN` in `env`, because
`@changesets/changelog-github` reads it to resolve PR links. Local `bun run changeset version` then needs
a token too; `docs/releasing.md` says to run versioning only in CI.

Grouping beyond Major/Minor/Patch (Tauri's `patch:bug` tags) is not possible in Changesets' changelog
API. Use a leading word instead, enforced by the writing rules: "Added", "Fixed", "Improved",
"Changed", "Deprecated", "Removed". The family Release script (below) groups lines by that word.

### Changeset writing rules (for `AGENTS.md` and `.changeset/README.md`)

Adapted from Zed, Biome and CodeMirror:

1. **Write one only if a user of the package can see or feel the difference**, or a public API changed.
   Benchmark tooling, test fixtures, agent instructions, CI and internal refactors get no changeset.
   (`bun run changeset --empty` exists for a PR that needs to say "no release".)
2. **Write for someone who uses the package and has never seen our code.** No internal type names,
   module names, plan numbers, worker protocol terms or reviewer evidence. Implementation detail goes in
   the PR description.
3. **Start with the verb:** "Added", "Fixed", "Improved", "Changed", "Deprecated", "Removed". Past
   tense for what changed; present tense for how it behaves now.
4. **Name the API, option, event or keybinding** in backticks, exactly as a user types it.
5. **One to three sentences.** Longer only for a breaking change or a new feature, and then with a
   short code sample.
6. **Fixes say what was wrong as the user saw it**, not what the code now does internally.
7. **Performance entries carry a number and the benchmark** ("about 30% less frame time in the
   `scroll-1m-lines` benchmark, WebGL renderer"), or they say plainly what got faster.
8. **Breaking changes (pre-launch patch bumps included) start with "Breaking:"** and say what to
   change in calling code.
9. Sentence case, full stops, Plan 336's copy rules: say what it is and does.

Examples from our pending changesets and changelogs. The rewrites guess at the user-visible effect
where the original does not state it; whoever writes the real entry must check it.

| Today                                                                                                                                                                                                                                                                       | Problem                                                                | Rewrite                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Own source delivery and contribution lifetimes in document analysis. Use typed structural and highlighter operations with immutable worker reads, preserve exact pinned work, and reject partial diff sources before syntax preparation." (`@singapore-editor/core` 0.2.6) | Internal design vocabulary; no user can tell what changed.             | If nothing visible changed: no changeset. If it fixed a symptom: "Fixed syntax colors in diff views briefly showing the previous file's highlighting after the diff source changed."                                       |
| "Release each worker WebGPU device once and wait for pending acquisition and recovery cleanup before confirming disposal. Bound shutdown waits with a timeout, including failures while the worker is idle."                                                                | Describes the mechanism; the user-facing change is in the last clause. | "Fixed `dispose()` on worker terminals resolving before the GPU device was released, and hanging when the worker was idle. It now waits for cleanup and gives up after a timeout."                                         |
| "Document scrollback as native page-granular retention and expose its byte budget through core, session, and appearance APIs. Zero bytes disables history. …" (four more sentences)                                                                                         | The feature is buried; seven sentences.                                | "Added the `scrollbackByteLimit` option, which caps scrollback memory in bytes. `0` turns scrollback off. Scrollback is kept in whole pages, so the number of retained lines can slightly exceed what the limit suggests." |
| "Upload native glyph records directly to WebGPU and read their existing layout in the glyph shader."                                                                                                                                                                        | No user effect stated, no number.                                      | "Improved WebGPU rendering speed for output with many new glyphs by uploading glyph data without an extra copy (N% faster in `<benchmark>`)." If not measured: no changeset, or "Improved WebGPU glyph upload speed."      |
| "Expose the default row overscan so benchmark tooling can bound retained rows against the editor's viewport policy."                                                                                                                                                        | Written for our benchmark, not for users.                              | "Added the `DEFAULT_OVERSCAN` export, the number of rows the editor renders beyond the visible area." Or no changeset if the export exists only for our tooling (then mark it `@internal`).                                |
| "Add agent-facing autonomous performance research instructions and resumable checkpoint writes around the existing benchmark procedures."                                                                                                                                   | Not shipped behavior.                                                  | No changeset.                                                                                                                                                                                                              |
| "Keep comparison browser socket paths short when the benchmark directory has a long path."                                                                                                                                                                                  | Benchmark harness.                                                     | No changeset.                                                                                                                                                                                                              |
| "Stabilize delayed-readiness first-paint browser checks by awaiting the editor's highlight-settlement signal." (core 0.2.1)                                                                                                                                                 | A test fix.                                                            | No changeset.                                                                                                                                                                                                              |
| "Refresh glyph resources when browser fonts load or fail, including replacements with unchanged fitted metrics." (ghostty-webgpu 0.3.16)                                                                                                                                    | Close; says the mechanism.                                             | "Fixed text drawn in a fallback font staying on screen after the web font finished loading."                                                                                                                               |
| "Add an explicit experimental Canvas pixel paint mode with a lazily loaded packed WASM compositor …" (0.3.13)                                                                                                                                                               | Nearly good; too long, internal terms.                                 | "Added an experimental `canvas` paint mode `pixel`, which composites cells in WebAssembly. It loads on first use. Worker terminals report it as unsupported."                                                              |

Good entries already in our history, to keep as models: "Keep word-wrap choices in retained logical
editor views across native editor remounts" is close to a user-visible fix; with a verb change it reads
"Fixed word wrap resetting when an editor view remounts."

Enforcement: a CI check (`scripts/release/changeset-lint.mjs`) that fails on a pending changeset that
does not start with one of the six verbs, exceeds four sentences without a code block, or contains a
list of banned internal words maintained beside it (for example `retained`, `owned`, `settlement`,
`contribution`, `provenance`, `pinned work`). The independent PR reviewer also reads the changeset.

### GitHub Releases in fregat

- Set `createGithubReleases: false` on the publish step, so `changesets/action` does not create 21
  Releases per Singapore publish.
- Add `scripts/release/github-release.mjs`, run after a successful publish (TanStack's pattern): for
  each family whose version changed, create one Release.
  - Tag and title: `singapore@0.3.0` / "Singapore 0.3.0", `ghostty-webgpu@0.4.0` / "ghostty-webgpu
    0.4.0", `hotkeys@0.1.0` / "hotkeys 0.1.0". Changesets' own per-package git tags stay as they are.
  - Body: optional hand-written summary from `.changeset/release-notes/<family>.md` (deleted after use;
    required for minors and majors, optional for patches, pnpm's lead paragraph), then the entries from
    the family's `CHANGELOG.md` section grouped by leading verb (Added, Improved, Fixed, Changed,
    Deprecated, Removed; Breaking first), each with its PR link. For Singapore, entries from packages
    other than `core` get the package name as prefix: "`@singapore-editor/lsp`: Fixed …".
  - Footer: install command, links to the docs changelog page and the migration guide when one exists.
  - `next` snapshots create no Release. PR previews comment on the PR only.
- Retire the hand-built `hotkeys-0.0.2-…` pre-release once hotkeys is on npm, or edit its body to one
  sentence pointing to npm. Its current body is review evidence, not notes.

### GitHub Releases in the mirrors

- Extend `mirror.yml`: after the split, for each family Release created since the last mirror run,
  push a tag `v<version>` on the split commit that corresponds to the release commit, and create a
  GitHub Release in the mirror with the same body plus one line: "Developed in
  [fregat](https://github.com/ShaulLavo/fregat). Report issues there." This follows Symfony's split
  repositories. The deploy keys can push tags; creating Releases needs a token with `contents: write` on
  the mirrors (a fine-grained token or a GitHub App, stored as a secret; owner sets it up).
- Mirror settings (Track C): Issues off, Discussions off, Wiki off, About text starting "Read-only
  mirror of `<folder>` in fregat", and a `close-pull-request.yml` like Laravel's that closes PRs with a
  pointer to fregat. The workflow file has to live in the mirrored folder (for example
  `ghostty-webgpu/.github/workflows/close-pull-request.yml`), guarded with
  `if: github.repository == 'ShaulLavo/ghostty-webgpu'` so it never runs in fregat. Check first that
  fregat's CI does not try to run workflows found in subfolders (GitHub only reads the root
  `.github/workflows`, so it will not).

### Release notes on the docs sites

- Each docs site gets a "Changelog" page generated at build time from the family's `CHANGELOG.md`
  (CodeMirror's combined changelog page; Ghostty's release-notes index). The Starlight plugin
  [`starlight-changelogs`](https://www.npmjs.com/package/starlight-changelogs) (0.7.0) renders Changesets
  changelogs and GitHub Releases; try it first, and fall back to a 50-line Astro loader if it cannot
  merge 21 package changelogs into one Singapore page.
- API names in entries link to the generated API reference (CodeMirror's `](##name)` trick: the
  generator rewrites a reference-style link to the reference URL).
- Minor and major release posts live in a "Releases" section of each product site, one page per
  version, Ghostty's structure: summary with scale, highlights with media, breaking changes, full list,
  what is next. Fregat's site gets the launch post.

### Snapshot (`next`) job

Add to `release.yml`, after `version`, when `hasChangesets == 'true'` and trusted publishing is on:

```bash
bun x changeset version --snapshot next
bun scripts/release/prepare.mjs
node node_modules/@changesets/cli/bin.js publish --tag next --no-git-tag
```

Run it in a disposable checkout (the version PR job already uses one). It publishes every package that
has a pending changeset, with versions such as `0.3.21-next.20261008141200.0df5eb8`. Fregat's own apps
keep consuming the workspace copies; `next` is for outside early users and for checking fixes.

### PR previews

Install the pkg.pr.new GitHub App on fregat and add a `preview.yml` triggered by the `preview` label
(Vite's pattern, not every PR: our PR volume is high). `pkg-pr-new publish --compact` with the built
package directories; it comments install URLs on the PR. Nothing reaches npm.

## 4. Post-launch issue intake

Track H empties the tracker first; these go live when the count reaches zero.

### Repositories

- **fregat** takes every issue, including Singapore, ghostty-webgpu and hotkeys. Mirrors have Issues
  off; their READMEs and `package.json` `bugs.url` link to the matching fregat form, for example
  `https://github.com/ShaulLavo/fregat/issues/new?template=ghostty-webgpu-bug.yml`.
- **Discussions on in fregat**, with categories: Announcements (owner only; release posts are linked
  here), Q&A (answerable, for "how do I"), Ideas (feature requests), Show and tell. Feature requests go
  to Ideas (Zed's choice), so issues stay actionable. Ghostty's stricter triage-in-Discussions model is
  worth adopting only if bug volume overwhelms the owner; start with forms.

### Issue forms (`.github/ISSUE_TEMPLATE/`)

`config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Question
    url: https://github.com/ShaulLavo/fregat/discussions/new?category=q-a
    about: Ask how to do something.
  - name: Feature idea
    url: https://github.com/ShaulLavo/fregat/discussions/new?category=ideas
    about: Suggest a feature or a change.
  - name: Security report
    url: https://github.com/ShaulLavo/fregat/security/advisories/new
    about: Report a vulnerability privately.
```

Forms, one per product so each can ask the right questions and pre-apply the product label:

| File                     | Label applied                                | Required fields beyond the description                                                                                                                                                   |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fregat-bug.yml`         | `fregat`, `needs triage`                     | Fregat version or commit (Settings shows it; the release endpoint reports it), client (browser, desktop, Mac, TUI, phone), OS, steps, logs (`bun run logs --since 10m` output, redacted) |
| `singapore-bug.yml`      | `singapore`, `needs triage`                  | Package versions (`npm ls '@singapore-editor/*'`), browser and version, framework (none, React, Solid), reproduction link (StackBlitz template from Track F)                             |
| `ghostty-webgpu-bug.yml` | `ghostty-webgpu`, `needs triage`             | Version, renderer (WebGPU, WebGL2, Canvas 2D, DOM, auto), browser and GPU (`chrome://gpu` summary), main thread or worker, reproduction or the escape sequence that triggers it          |
| `hotkeys-bug.yml`        | `hotkeys`, `needs triage`                    | Versions, adapter (browser, terminal, React), keyboard layout and OS, the binding and the key events                                                                                     |
| `performance.yml`        | product label, `performance`, `needs triage` | What was slow, how measured, machine, numbers; a trace if possible                                                                                                                       |

Each form ends with checkboxes: searched existing issues; reproduces on the latest `next` build.
Personal accounts cannot use GitHub's issue types (`type: Bug` in Vite's form), so labels carry the
type.

### Labels

Prefixed families (Biome, Zed). Replace GitHub's defaults; keep `in progress`.

- Product: `fregat`, `singapore`, `ghostty-webgpu`, `hotkeys`.
- Type: `bug`, `performance`, `docs`, `regression` (worked in a previous release).
- Status: `needs triage` (applied by forms), `needs repro`, `needs info`, `confirmed`, `in progress`
  (existing claim rule), `blocked`.
- Resolution (closing reasons): `duplicate`, `wontfix`, `not planned`, `fixed in next`.
- Contributor: `good first issue`, `help wanted`.
- Area labels only when an area accumulates issues (`area:lsp`, `area:renderer-webgl`); not up front.

### Triage automation (small, all in `.github/workflows/issue-triage.yml`)

- Adding `confirmed`, `needs repro` or `needs info` removes `needs triage` (Vite's `issue-labeled.yml`).
- `needs repro` posts a comment asking for a reproduction; a daily job closes `needs repro` or
  `needs info` issues after 14 days without a reply from the author (Vite uses 3 days; we are slower to
  respond). Closing comment says how to reopen.
- When a PR that closes an issue lands, label the issue `fixed in next`; when the release containing
  it publishes, comment "Released in ghostty-webgpu 1.2.3" and remove the label. Implemented in
  `github-release.mjs` by reading `Closes #N` from the PRs in the release.
- Lock closed issues after 30 days of inactivity (Vite) so people open new reports instead of
  commenting on old ones.
- Plan 295's collector reads `needs triage` and `regression` for the owner's review.
- No AI auto-replies to users. The owner's issue review (global rules) classifies them.

### Community files (Track C owns them; listed so they match this intake)

`CONTRIBUTING.md` (how to report, where questions go, PRs welcome after an issue or discussion),
`SECURITY.md` (private advisories), `.github/pull_request_template.md` with a "Changeset" line that
links the writing rules, `SUPPORT.md` pointing to Discussions.

## 5. Track G checklist

Pre-launch, in order:

- [ ] Fix `ghostty-webgpu/package.json` `repository` (fregat plus `directory`), `homepage`, `bugs`.
- [ ] Check every public package's `repository.url` is exactly `git+https://github.com/ShaulLavo/fregat.git`.
- [ ] Owner: npm trusted publishers for all 24 packages; set `NPM_TRUSTED_PUBLISHING=true`.
- [ ] Bump the pinned npm CLI in `release.yml` to 11.21.0+.
- [ ] Publish once; confirm npm shows the current versions with provenance; then set "disallow tokens"
      on each package.
- [ ] Add `.changeset/changelog.cjs` wrapping `@changesets/changelog-github` (`disableThanks`, PR link,
      no same-group dependency lines); add `@changesets/changelog-github` as a dev dependency.
- [ ] Pass `GITHUB_TOKEN` to the `version` job's environment.
- [ ] Add `snapshot` config and the `next` publish step; publish the first `next` build (Plan 336
      acceptance).
- [ ] Set `createGithubReleases: false`; add `scripts/release/github-release.mjs` (one Release per
      family, verb-grouped body, optional summary file); test it against a dry run.
- [ ] Extend `mirror.yml` to tag `v<version>` and create the matching Release in each mirror; owner
      provides a mirror Release token.
- [ ] Mirror settings: Issues off, About text "Read-only mirror …", PR auto-close workflow in each
      mirrored folder.
- [ ] Write `docs/releasing.md`: channels table, weekly cadence, pre-launch and post-launch version
      policy, deprecation policy, the changeset writing rules with examples, how to cut a minor, a major
      (pre mode), and a critical patch.
- [ ] Add the changeset writing rules to `AGENTS.md` (short form, linking `docs/releasing.md`) and
      `.changeset/README.md`.
- [ ] Add `scripts/release/changeset-lint.mjs` to the gates.
- [ ] Rewrite the pending changesets in `.changeset/` under the new rules; delete the ones that need no
      release.
- [ ] Merge the version PR weekly, not per push.
- [ ] Add the `preview` label workflow with pkg.pr.new.
- [ ] Add a pre-launch note to each package README: patches may break, pin exact versions.
- [ ] Edit or retire the `hotkeys-0.0.2-…` GitHub pre-release.
- [ ] Docs sites (with Track F): a Changelog page per family from `CHANGELOG.md`; API names linked to
      the reference.

At launch (owner decides the date and the version number):

- [ ] Owner confirms `1.0.0` (recommended) or another first stable version per family.
- [ ] Rewrite each family's `CHANGELOG.md` head: a "1.0.0" entry summarizing the product; older
      pre-launch entries stay below a "Pre-launch history" heading.
- [ ] Release posts for Singapore, ghostty-webgpu and hotkeys, plus the Fregat launch post, on the sites
      and as Discussions announcements.
- [ ] xterm.js migration guide published before the ghostty-webgpu 1.0 post.
- [ ] Turn on contributor thanks in the changelog wrapper for authors outside the owner's account.
- [ ] Switch issue intake on: forms, labels, Discussions categories, triage workflow (section 4).
- [ ] Update the owner rule in `~/.agents/AGENTS.md` ("Package versions") to strict semver, so agents
      start choosing `minor` and `major`.

## Links

- Vite releases: https://vite.dev/releases
- React versioning policy: https://react.dev/community/versioning-policy
- Biome versioning: https://biomejs.dev/internals/versioning/ and `biomejs/biome` `CONTRIBUTING.md`
- Astro contributing (changesets, pre mode, previews): `withastro/astro` `CONTRIBUTING.md`
- TanStack release workflow: `TanStack/query` `.github/workflows/release.yml`,
  `scripts/create-github-release.mjs`
- Zed release notes rules: `zed-industries/zed` `docs/src/development/release-notes.md`
- Ghostty release notes: https://ghostty.org/docs/install/release-notes; `ghostty-org/ghostty`
  `CONTRIBUTING.md` (Issue Triage discussions, vouch system)
- CodeMirror release script: `codemirror/dev` `bin/cm.js` (`changelog()`, `bumpVersion()`)
- Deno stability and releases: https://docs.deno.com/runtime/fundamentals/stability_and_releases/
- Tauri covector config: `tauri-apps/tauri` `.changes/config.json`
- npm trusted publishing: https://docs.npmjs.com/trusted-publishers
- pkg.pr.new: https://github.com/stackblitz-labs/pkg.pr.new
- Laravel split PR closer: `illuminate/support` `.github/workflows/close-pull-request.yml`
