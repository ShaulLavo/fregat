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

The remaining packages use texts included in their installed archives.
