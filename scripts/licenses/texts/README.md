# Reviewed package licence texts

The generator uses these files only for the exact package version in the filename
when its published archive omits a licence text. Every file includes a source URL.
A new version needs review; unresolved packages fail the build.

- `rehype-katex`, `remark-math`, `http_ece`, and `standardwebhooks`: copied from the
  npm release's `gitHead`. Standard Webhooks' library MIT licence is in
  `libraries/LICENSE`; its repository root licence covers the specification.
- `drizzle-orm`: copied from the commit referenced by its `0.45.3` tag.
- `react-remove-scroll-bar`: copied from upstream's commit adding the licence file.
  The npm archive declares MIT; its registry `gitHead` is unavailable upstream.
  The pinned licence supplies the author's copyright and full MIT terms.
- `woff2sfnt-sfnt2woff`: the release's source headers name Onur Demiralay, 2014,
  and MIT. Upstream omits a standalone licence. This notice retains that copyright
  and supplies the complete standard MIT terms.
- `is-node-process`: the repository at the `v1.2.0` tag has no LICENSE file, and
  never has at any commit. `package.json` and the npm registry declare MIT; the
  registry's maintainer of record is Artem Zakharchenko (`kettanaito`), the
  repository's sole committer since it was created in 2021. This notice retains
  that copyright and supplies the complete standard MIT terms.
- `strict-event-emitter`: the repository at the `v0.5.1` tag has no LICENSE file,
  and never has at any commit. `package.json` names the author directly
  ("Artem Zakharchenko <kettanaito@gmail.com>") and declares MIT. This notice
  retains that copyright and supplies the complete standard MIT terms.
- `@open-draft/deferred-promise`: the `v2.2.0` release commit predates the
  repository's LICENSE.md. Copied from the commit that added it; the copyright
  is dated "2022–present", covering the 2022 release.

The remaining packages use texts included in their installed archives.
