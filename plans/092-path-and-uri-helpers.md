# Unify path, URI, and containment helpers

Implementation note, 2026-09-12: Plan 096 moved native-picker path conversion to `components/utils/picked-path.ts`. The warning in `lib/path-formatters.ts` points to that path and retains all basename distinctions. See [web layering](../docs/web-layering.md).

Status: proposed, implementation not started. Requested 2026-09-11.

This is the `basename`-trap plan. Every step below states the behavioural divergence before the merge
and names which behaviour wins. A step that reads "extract the shared helper" without that statement
is not ready to execute. [Root PLAN.md](../PLAN.md) owns execution order; this plan owns only the
merges. It depends on [Plan 090 regression record](../docs/duplicate-defect-regressions.md) landing two URI bug fixes first.

The rule this plan exists to respect is [AGENTS.md:18](../AGENTS.md): six `basename` variants in
`apps/web/src` share `(string) => string` and disagree on the empty-path answer, so a wrong merge
typechecks and ships. Nine of the helpers below are also `(string) => string` or `(string, string) => string`.

## Reconcile the baseline

Platform base `75caae889d967fed0e0c8df85aa315670ef9fe49`. Capture HEAD and the full dirty diff before
editing, and recheck every line reference here — the census behind this plan was built at the same
commit, but the drift check in [plans/README.md](README.md) is not optional.

| Existing owner                                                   | Work to build on                                                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/path-formatters.ts`                            | `basename` divergence census at `:1-12`, `displayPath:18`, `toTreePath:33`, `canonicalTreePath:41`                                             |
| `packages/contracts/src/index.ts`                                | Sole `"."` export (`packages/contracts/package.json`); new helpers reach `apps/server` and `apps/web` only through it                          |
| `packages/contracts/src/workspace-search-match.ts`               | `createWorkspaceSearchMatcher:15`, `workspaceSearchGlobPatterns:30`, private whole-word walk `:170-209`                                        |
| `packages/client-core/src/files/path.ts`                         | `normalizeWorkspaceRoot:10`, `isPathInWorkspace:21`, and the documented "one normalizer, one answer" rule `:4-9`                               |
| `apps/server/src/fs/path.ts`                                     | Canonical `isOutsideRoot:127` with its comment at `:122-126`, plus `toPosix:100`                                                               |
| `apps/server/src/fs/workspace-edit.ts`                           | Weak `assertInside:2635` / `isSameOrDescendant:2643`, lease overlap `:1854-1875`, local `joinRelative:2653`, `toPortablePath:2658`             |
| `apps/server/src/git/path-utils.ts`                              | `repositoryRelativePath:41`, `relativeInsideRoot:56`; already imports `toPosix` at `:3`                                                        |
| `apps/server/src/fs/search-shared.ts`                            | `joinRelative:182`, `globMatchPath:194` reading `context.root.relativePath`                                                                    |
| `apps/server/src/lsp/typescript/shared/boundary.ts`              | Exported `normalizeNativePath:129`, `isInsidePath:133`, `samePath:210`, `typeScriptLibDirectory:214`, two private URI spellings `:177`/`:182`  |
| `apps/server/src/lsp/typescript/session.ts`                      | Six re-declared twins at `:364`, `:388`, `:542`, `:546`, `:550`, `:557`; already imports from `./shared/error` at `:31`                        |
| `apps/server/src/lsp/registry.ts`, `lsp/installers.ts`           | `firstExistingPath`/`exists`/`virtualEnvironmentPaths` at `registry.ts:962,972,981` and `installers.ts:804,818,827`                            |
| `/Users/shaul/Desktop/D/Editor/packages/lsp-plugin/src/paths.ts` | `fileNameToDocumentUri:16`, `documentUriToFileName:21`, `normalizeFileNamePath:31-35` — the form to copy and the inverse already in production |

Three census references were corrected while checking them. They are recorded at the step that uses
them: `fs/watch.ts:449` → `:450`, the ninth URI variant's relative-input behaviour, and the
`getDefaultLibFilePath` difference, which does not exist.

## Land Plan 090's URI fixes before adopting the shared helper

Two sites build a `file:` URI wrongly and both feed `openDefinition`, the same command the correct
variants feed:

- `apps/web/src/features/address/utils/definition-target.ts:13` emits `` `file://${path.startsWith('/') ? path : `/${path}`}` `` — unencoded, so a path containing a space or `#` never string-compares equal to the URI the LSP layer opened the document under.
- `apps/web/src/features/chat/hooks/use-open-file-reference.ts:47` emits `` `file://${reference.path.split('/').map(encodeURIComponent).join('/')}` `` with no leading-slash strip, so relative `src/a.ts` becomes `file://src/a.ts`, where `src` parses as the **host** and `new URL(…).pathname` is `/a.ts` — the wrong file.

Both belong to [Plan 090 regression record](../docs/duplicate-defect-regressions.md). Swapping them onto a shared helper in the
same pass repairs them silently and destroys the evidence that they were broken. Do not start the
next section until 090's fixes and their regression tests are on `main`.

## Adopt the editor's `file:` URI normalisation

Seven copies of one function, verified at this HEAD:

| Site                                                                 | Name                        |
| -------------------------------------------------------------------- | --------------------------- |
| `apps/server/src/lsp/language.ts:10`                                 | `fileUriForPath` (exported) |
| `apps/server/src/lsp/typescript/shared/boundary.ts:182`              | `relativePathToDocumentUri` |
| `apps/web/src/features/command-palette/command-palette-utils.ts:352` | `fileUriForPath` (exported) |
| `apps/web/src/features/command-palette/document-symbols.ts:210`      | `fileUriForPath`            |
| `apps/web/src/features/search/utils/open-match.ts:59`                | `fileUriForPath`            |
| `apps/web/src/features/editor/utils/language-server-plugin.ts:320`   | `fileUriForPath`            |
| `apps/web/src/features/editor/utils/diff-documents.ts:131`           | `fileUri`                   |

All seven are the same two lines: strip leading slashes, split on `/`, `encodeURIComponent` each
segment, prefix `file:///`. `apps/web/src/lib/diagnostic.ts:39` already delegates to
`fileNameToDocumentUri` from `@singapore-editor/lsp-plugin/paths`, and `diagnostic.ts:34` already uses that
package's `documentUriToFileName` as the inverse.

**Reconcile — backslash.** The seven copies percent-encode it: `a\b.ts` → `file:///a%5Cb.ts`. The
editor's `normalizeFileNamePath` (`Editor/packages/lsp-plugin/src/paths.ts:32`) runs
`replaceAll('\\', '/')` first, giving `file:///a/b.ts`. On POSIX a backslash is a legal filename
character, so this is a real behaviour change and it must be argued rather than assumed. **Adopt the
editor's form.** The reason is round-tripping, not taste: the inverse already in production,
`documentUriToFileName` (`paths.ts:21-28`), decodes `%5C` back to `\` and then runs the _same_
`normalizeFileNamePath`, so the copies' output decodes to `/a/b.ts` — a different path from the one
encoded. The copies are not round-trippable with the inverse the app already uses; the editor's form
is.

**Reconcile — everything else agrees.** On every POSIX input traced: `''` → `file:///` from both
spellings (the editor's `normalizeFileNamePath` returns `'/'` for empty, and `encodePathname` keeps
the index-0 empty segment), `a/b`, `/a/b/`, and `/a/b c.ts` → `%20`.

**Reconcile — the ninth variant.** `boundary.ts:177` `fileNameToDocumentUri` is a different function
under the same name as the editor's. It calls `normalizeNativePath` (`boundary.ts:129`), which is
`path.resolve(input)` — so a _relative_ input is resolved against the server process's working
directory, not the session root, before encoding. **Census correction:** it does not emit a
host-shaped `file://a/b`; `path.resolve` makes the input absolute, and `encodePathPart:187` maps the
index-0 empty segment to `''`, so the output always has three slashes. The hazard is the cwd
resolution, not the slash count. Leave it out of the merge and give it a one-line comment saying it
resolves against the process cwd, or give it the session root explicitly.

**Home** `packages/contracts/src/file-uri.ts`, re-exported from `packages/contracts/src/index.ts`.
A `file:` URI is the LSP wire spelling of a path — pure string work with no runtime dependency — and
contracts is the only layer both `apps/server` and `apps/web` import. Copy the editor's normalisation
into contracts rather than importing it: `packages/contracts/package.json` lists only `minimatch` and
`valibot`, and it must stay that way.

**Parity test placement.** The test that pins the copy to `@singapore-editor/lsp-plugin` cannot live in
contracts, because contracts must not take that dependency. `@singapore-editor/lsp-plugin` is an `apps/web`
dependency (`apps/web/package.json:49`) and not a server one, so the parity test lives in
`apps/web/src/lib/tests/` and imports both the contracts helper and `@singapore-editor/lsp-plugin/paths`.

## Split `parentPath` by behaviour family

Six implementations, three behaviour families. **Do not merge across families.** All six are
`(string) => string` or `(string, string) => string`; a wrong swap typechecks.

**Family A** — `lastIndexOf('/')`, `''` fallback, keeps the leading slash:
`apps/web/src/features/git/utils/paths.ts:2` (exported, with the doc comment) ·
`apps/web/src/features/workspace/utils/conflict-editor-resolution.ts:139` ·
`apps/web/src/features/editor/components/language-server-references-pane.tsx:306`.

**Family B** — `(path, rootPath)`, returns the root rather than an empty string:
`apps/web/src/features/workspace/utils/event-model.ts:289` (exported) ·
`apps/web/src/features/workspace/state/event-conflict-adapter.ts:290`.

**Family C** — `split('/').filter(Boolean)`, **drops the leading slash**:
`apps/web/src/features/file-picker/model.ts:103` (exported).

**Reconcile — the divergent answers.** With Family B's root fixed at `'/w'`:

| Input           | Family A | Family B | Family C |
| --------------- | -------- | -------- | -------- |
| `'/a/b'`        | `'/a'`   | `'/a'`   | `'a'`    |
| `'a/b/'`        | `'a/b'`  | `'a/b'`  | `'a'`    |
| `'README.md'`   | `''`     | `'/w'`   | `''`     |
| `'/w'` (= root) | `''`     | `'/w'`   | `''`     |

Family A's `''` for `'README.md'` is a relative-namespace empty string; Family B's `'/w'` is a real
server path. A trailing separator costs Family C a whole level. Nothing reconciles these — they are
three functions.

**Homes.** Family A → `apps/web/src/lib/path-formatters.ts` as `parentPath`; it has three consumers
in three different feature buckets, which clears the `lib/` rule at [AGENTS.md:15](../AGENTS.md), and
that file already owns `basename`, `displayPath`, `toTreePath`, and `canonicalTreePath`. Family B →
stays exported from `event-model.ts:289`; delete the private twin at `event-conflict-adapter.ts:290`
and import it. Family C → stays in `file-picker/model.ts`, **renamed `pickerParentPath`**, with a
one-line comment that it returns a root-relative path because the picker's `ROOT_PATH` is `''`.

**Rename the odd one out and collapse the alias pair.**
`apps/web/src/features/workspace/utils/tree-pane-state.ts:186` `parentTreePath` is
`containerTreePath(path, false)` from `apps/web/src/features/workspace/utils/entry-paths.ts:31`
spelled again — both call `canonicalTreePath` first, both `lastIndexOf('/')`, both return `''`.
Delete `parentTreePath`, call `containerTreePath(treePath, false)` at
`tree-pane-state.ts:177,377,411`. `entry-paths.ts:26-30` already carries the doc comment.

**Update the census comment.** `path-formatters.ts:1-12` warns about the `basename` family only. Add
the three `parentPath` families and their divergent answers to it in the same commit.

`apps/tui/src/files/utils/list.ts:58` `parentDirectory` is Family C in another app. Leave it;
[Plan 094](094-client-core-web-tui-parity.md) owns web↔TUI moves.

## Fold the absolute-path display guard

Three byte-identical private wrappers around `displayPath`:
`apps/web/src/features/git/utils/diff-document.ts:279` `displayDiffPath` ·
`apps/web/src/features/search/utils/buffer-document.ts:36` `displaySearchBufferRootPath` ·
`apps/web/src/features/editor/utils/conflict-diff-document.ts:41` `displayConflictPath`. All three
already import `displayPath` from `@/lib/path-formatters` on line 1.

**Reconcile — none.** Verified identical on `''`, on `'/'` (where bare `displayPath:18` returns
`'//'` and the guard returns `'/'`), and on `'a/b'`.

**Home** `apps/web/src/lib/path-formatters.ts` as `absoluteDisplayPath`. Do not fold the guard into
`displayPath` itself in this pass: `displayPath` has 14 call sites across 11 files, and its `'//'`
answer for `'/'` stays load-bearing until each of them is checked. Record that as a separate decision
below.

## Make one containment rule canonical on the server

Eight spellings of "is `candidate` inside `root`", two of them wrong.

| Site                                                                    | Rule                                       | Verdict                                         |
| ----------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `apps/server/src/fs/path.ts:127` `isOutsideRoot`                        | `rel === '..'`, `'..' + sep`, `isAbsolute` | Canonical, exported, documented at `:122-126`   |
| `apps/server/src/fs/path.ts:140` `isSameOrDescendant`                   | Calls `isOutsideRoot`                      | Correct                                         |
| `apps/server/src/fs/watch.ts:450` `relativePathInside`                  | Calls `isOutsideRoot`                      | Correct (census said `:449`)                    |
| `apps/server/src/orchestration/session-discovery.ts:467` `containsPath` | Same rule, inlined                         | Correct, spelled out again                      |
| `apps/server/src/fs/workspace-edit.ts:2635` `assertInside`              | `'..' + sep` + `isAbsolute` only           | **Bug: accepts the immediate parent directory** |
| `apps/server/src/fs/workspace-edit.ts:2643` `isSameOrDescendant`        | `'..' + sep` + `isAbsolute` only           | **Same weak rule**                              |
| `apps/server/src/git/path-utils.ts:56` `relativeInsideRoot`             | `rel.startsWith('..')`                     | **Bug: a file named `..foo` reads as outside**  |
| `apps/server/src/git/service.ts:801` `pathspecForRepository`            | `rel.startsWith('..')`                     | **Same bug**                                    |
| `apps/server/src/lsp/registry.ts:987` `isInsideOrEqual`                 | `rel.startsWith('..')`                     | **Same bug**                                    |
| `apps/server/src/lsp/typescript/shared/boundary.ts:133` `isInsidePath`  | `rel.startsWith('..')`                     | **Same bug**                                    |

**Reconcile — `..foo` becomes inside at four sites.** `path.relative('/a/b', '/a/b/..foo')` is
`'..foo'`, a legal child. `startsWith('..')` calls it an escape. Adopting the canonical rule makes
`relativeInsideRoot` return `'..foo'` instead of `null`, stops `pathspecForRepository` throwing
`GIT_REPOSITORY_NOT_FOUND`, lets `registry.ts` treat the file as in-root, and lets the TypeScript
session read it (`boundary.ts:140` `canReadFile` gates on `isInsidePath`). That is the right
direction: the filesystem layer already accepts such a file, and
`apps/server/src/fs/tests/containment.test.ts` already pins it with "reads a root-level file whose
name begins with two dots". Use that test as the known-good control before changing the others.

**Reconcile — the parent becomes outside at `workspace-edit.ts`.** The weak rule differs from the
canonical one for exactly one relative value: `'..'`, the immediate parent.
`assertInside(root, parent)` currently returns without throwing, so a workspace edit targeting the
parent directory passes containment. That is the serious half and it needs a test.

**Census correction.** The census attached the required test to `pathsOverlap` (`:2649`) because it
feeds the edit-conflict check at `:1857-1872`. `pathsOverlap` is symmetric —
`isSameOrDescendant(left, right) || isSameOrDescendant(right, left)` — and when `relative(L, R)` is
`'..'`, `relative(R, L)` is an ordinary child name, so the second call already answers true. The
`WORKSPACE_EDIT_BUSY` lease decision therefore does **not** change. Pin `assertInside` instead: the
new test asserts that a workspace edit whose target resolves to the workspace's parent is rejected
with `WORKSPACE_EDIT_INVALID`. Put it beside `apps/server/src/fs/tests/workspace-edit.test.ts`.

**Home** `apps/server/src/fs/path.ts`. It already exports `isOutsideRoot`, and
`apps/server/src/git/path-utils.ts:3` already imports `toPosix` from it, so the import direction is
established.

**Collapse the two names for one function.** `fs/watch.ts:450` `relativePathInside` and
`git/path-utils.ts:56` `relativeInsideRoot` are the same function: relative posix path, `''` for the
root itself, `null` when outside. Keep both properties and export one. Note that
`git/path-utils.ts:51-55` claims its rule is "deliberately the same one `WorkspacePaths.assertInside`
enforces" — it is not, and that comment is how the divergence survived. Delete or correct it.

## Tighten `isPathInWorkspace` and own the behaviour change

`packages/client-core/src/files/path.ts:21` is exported and normalises the root first. Three private
copies are byte-identical to each other and weaker than it:
`apps/web/src/features/search/utils/providers.ts:381` ·
`apps/web/src/features/workspace/hooks/use-tree.ts:247` ·
`apps/web/src/features/search/utils/buffer-dirty-documents.ts:75`. `providers.ts:17` already imports
`@workspace/client-core/files/search-client`, so the package is already on the web import path.

**This is a behaviour change, not a delete.** Two divergences:

- **Empty root.** The copies `return true` for every path. client-core returns
  `!path.startsWith('/') && !path.split('/').includes('..')`. Today, with no workspace root, an open
  buffer at an absolute path outside the workspace passes the containment check at
  `providers.ts:375` and at `buffer-dirty-documents.ts`; after the merge it stops passing and drops
  out of the dirty-buffer search set and the tree.
- **Trailing slash.** With root `'/repo/'`, client-core normalises to `'/repo'` and matches
  `'/repo/src/a.ts'`; the copies compare against `'/repo//'` and return false. The copies also
  compare `path === rootPath` against the raw root, so `'/repo'` with root `'/repo/'` is false for
  them and true for client-core.

Both changes move toward the documented rule at `packages/client-core/src/files/path.ts:4-9`. Write
the empty-root case down in the commit message and in a test, because it is the one a reviewer will
read as a regression.

`apps/web/src/features/workspace/utils/tests/path.test.ts` already exercises
`isPathInWorkspace` from `@workspace/client-core/files/path`; extend it rather than starting a file.

## Export the whole-word matcher, then the glob path

These two touch the same file, `packages/contracts/src/workspace-search-match.ts`, and its export
block at `packages/contracts/src/index.ts:86-91`. **3.7 first: 3.6 cannot use an export that does not
exist yet.**

**Whole-word matcher.** `apps/web/src/features/search/utils/replace.ts:391-430` and
`packages/contracts/src/workspace-search-match.ts:170-209` are 41 lines with zero differences,
including the surrogate-pair walk at `previousCodePointStart` and the `/^[\p{L}\p{N}_]$/u` class.
**Reconcile — nothing.** Neither copy is exported today, which is why a drift would ship silently:
the highlighted ranges would stop being the ranges the replace edits. Export `isWholeWordMatch` from
`workspace-search-match.ts:170` and add it to the index block at `index.ts:86-91`.

**Glob path.** Three spellings of one prefix strip:
`apps/server/src/fs/search-shared.ts:194` `globMatchPath(context, relativePath)` (ten call sites in
`fs/search.ts`, `fs/search-shared.ts`, `fs/search-fallback.ts`) ·
`apps/web/src/features/search/utils/providers.ts:388` `globMatchPath(rootPath, path)` ·
`apps/server/src/git/path-utils.ts:41` `repositoryRelativePath(rootPath, filePath)`, the same strip
under a third name with nine call sites in `git/status.ts` and `git/service.ts`.

**Reconcile — nothing behavioural.** All three: falsy root → passthrough, `path === root` → `''`,
non-prefix → passthrough unchanged, otherwise `slice(prefix.length)`. Verified line by line.

**Reconcile — argument order is the trap.** The two live spellings are root-first; the server's takes
a `FindContext` and reads `context.root.relativePath`. The census proposed
`workspaceSearchGlobPath(path, rootPath)`, which is the opposite order from both call-site spellings
and from `repositoryRelativePath`. Section 9.5 below is a whole family that became unmergeable for
exactly this reason. Settle the order before writing code; the default recommendation is root-first,
`(rootPath, path)`, matching what both call sites already type.

**Home** `packages/contracts/src/workspace-search-match.ts`, re-exported from the index. That module
already owns `createWorkspaceSearchMatcher:15` and `workspaceSearchGlobPatterns:30`, and the web and
server copies must agree or a dirty open buffer and its on-disk twin are filtered differently by the
same glob set. `fs/search-shared.ts:194` becomes a one-line adapter that reads
`context.root.relativePath` and calls the shared function; `git/path-utils.ts:41` becomes a re-export
or a one-line alias.

## Collapse the server's walker and LSP path helpers

**`joinRelative`.** `fs/search-shared.ts:182` (exported), `fs/tree.ts:153`, and
`fs/workspace-index.ts:1215` are byte-identical: `if (!parent) return child; return toPosix(path.join(parent, child))`.
`fs/workspace-edit.ts:2653` is **different** — a plain template join, so `('a/', 'b')` gives `a//b`
and `('a', './b')` gives `a/./b` where the other three normalise. Its five call sites are
`workspace-edit.ts:1223`, `:1243`, `:1689`, `:1810`, `:1838`, all passing `manifest.workspace` or
`workspacePrefix` as the prefix. Confirm those prefixes never carry a trailing slash and the relative
halves are already normalised before swapping; if either is unproven, leave the fourth alone and say
so in a comment. **Home** `fs/search-shared.ts:182` for the three that agree.

**`sortedDirents`.** `fs/workspace-index.ts:766` and `fs/search-fallback.ts:57` are identical and
sort **in place**. Both callers (`workspace-index.ts:724`, `search-fallback.ts:50`) iterate the
result immediately. **Reconcile:** keep the in-place mutation and document it, or make the shared one
copy and accept the allocation — do not leave the mutation undocumented in a now-shared helper.

**`toPortablePath`.** `fs/workspace-edit.ts:2658` is `fs/path.ts:100` `toPosix` under another name,
with one call site at `workspace-edit.ts:1049`. Delete it and import `toPosix`.

**TypeScript session twins.** `apps/server/src/lsp/typescript/session.ts` re-declares six helpers its
own `shared/boundary.ts` already exports: `normalizeNativePath:542` ≡ `boundary.ts:129`,
`samePath:546` ≡ `boundary.ts:210`, `isInsidePath:550` ≡ `boundary.ts:133`,
`typeScriptLibDirectory:557` ≡ `boundary.ts:214`, plus `canReadFile:364` ≡ `boundary.ts:140` and
`documentForFileName:388`. `session.ts:31` already imports from `./shared/error`, so the import
direction is established.

**Census correction — the `getDefaultLibFilePath` difference does not exist.** The census flagged
`session.ts:558` building the lib directory from `ts.getDefaultLibFilePath(defaultCompilerOptions())`
(`target: ES2023`, `session.ts:512-527`) against `boundary.ts:215` using
`ts.getDefaultLibFilePath({})`, and made "which argument is right" a blocking decision. Both sites
wrap the result in `path.dirname`. The options argument selects the lib **file name**, not its
directory, so `path.dirname` discards the only thing that differs and `canReadFile` cannot answer
differently. Confirm this once against the installed `typescript-language-service` build — it was not
resolvable in this checkout — and if it holds, keep `boundary.ts:214`'s `{}` and delete the decision.

**`isInsidePath` carries the `..foo` bug.** Apply the canonical rule from the previous section inside
this collapse, once, at `boundary.ts:133` — not twice, and not separately in `session.ts`.

**LSP installer helpers.** `apps/server/src/lsp/registry.ts:962,972,981` and
`apps/server/src/lsp/installers.ts:804,818,827` (`firstExistingPath`, `exists`,
`virtualEnvironmentPaths`) are byte-identical and in the same folder. **Home**
`apps/server/src/lsp/paths.ts`. `installers.ts:814` `existingPath` has no twin; leave it there.

**`locationForTextSpan`.** `apps/server/src/lsp/typescript/handlers/definition.ts:34-51` and
`handlers/references.ts:30-47` are the same 18 lines, and both files already import all five
dependencies from `../shared/boundary`. Move it to `shared/boundary.ts` and export it.

## Leave the root-relative family split

Six functions convert an absolute path to a root-relative one. They are **not** duplicates and must
not be merged. Deliverable: renames and a header comment.

| Site                                                                | Root equals path | Outside the root |
| ------------------------------------------------------------------- | ---------------- | ---------------- |
| `apps/web/src/lib/path-formatters.ts:33` `toTreePath`               | `basename(path)` | unchanged        |
| `packages/client-core/src/files/path.ts:33` `toWorkspaceRelative`   | `'.'`            | `null`           |
| `apps/web/src/features/chat/utils/markdown-file-links.ts:153`       | `null`           | `null`           |
| `apps/web/src/features/chat/utils/composer-drop.ts:41`              | `null`           | `null`           |
| `apps/web/src/features/editor/state/workspace-edit-service.ts:2064` | `'.'`            | `null`           |
| `apps/web/src/features/workspace/utils/tab-model.ts:148`            | `basename(path)` | unchanged        |

**Argument order.** `toWorkspaceRelative(rootPath, path)` takes its arguments in the **opposite**
order from both chat copies, which are `workspaceRelativePath(path, rootPath)`. All of them are
`(string, string) => string | null` or `(string, string) => string`, so a swap typechecks.

**Empty root.** client-core rejects `..` segments and absolute paths (`files/path.ts:24`);
`markdown-file-links.ts:157` only rejects a leading `/`; `composer-drop.ts:46` turns the prefix into
`'/'` when the root is empty, so **any** absolute path relativises; `workspace-edit-service.ts:2067`
special-cases `root === '/'` separately from `!root`.

`apps/web/src/features/git/utils/status-entries-for-tree.ts:23-27` already papers over `toTreePath`'s
root answer with its own prefix check before delegating — evidence that these answers are already
being worked around rather than shared.

**Do this, and nothing else.** Rename the two chat copies to something that names their rule, add a
header comment to `path-formatters.ts` listing the six and their two answers, and stop.
`tab-model.ts:148` `tabRelativeCopyPath` is the only safe fold into `toTreePath`, and even that
changes the `path === '', root === ''` answer from `''` to `'Root'` — fold it only with a test on
that case.

**Fix the stale `basename` census.** `path-formatters.ts:1-12` names five other variants and says
there are five. There is a sixth: `apps/web/src/features/search/utils/result-editor.ts:393`
`fileName` (`path.split('/').at(-1) || path`). It disagrees with
`apps/web/src/lib/file-icons.ts:637` `basenameForIconPath` on `'src/utils/'` — whole path versus
`'utils'` — and it is rendered as a search result header's bold label. Add it to the comment and
rename it `searchResultFileName`. Verify the other five while you are there:
`apps/web/src/features/editor/utils/file-path.ts:134` (lowercases),
`apps/web/src/lib/file-icons.ts:637` (whole-path fallback),
`apps/web/src/lib/platform/hydrate-picked-entry.ts:26` (normalises Windows separators),
`apps/web/src/features/terminal/utils/links.ts:404` and
`apps/web/src/features/chat/utils/markdown-file-links.ts:260` (both `''` rather than `'Root'`).

## Decide before writing code

- **Backslash in `file:` URIs.** Adopting the editor's `replaceAll('\\', '/')` changes the URI for a
  POSIX filename containing a backslash. Confirm no workspace in use relies on the encoded form, or
  accept it as a deliberate break. The round-trip argument above is the case for accepting it.
- **Glob-path argument order.** `(rootPath, path)` to match both live call sites, or
  `(path, rootPath)` as the census proposed. Pick one before the contracts export lands; changing it
  afterwards means editing twenty call sites a second time.
- **`isPathInWorkspace` with an empty root.** Confirm that dropping non-workspace buffers out of the
  dirty-buffer search set and the tree is wanted, and that no caller depends on today's
  admit-everything answer as a bootstrap state.
- **`displayPath`'s `'/'` answer.** Whether `absoluteDisplayPath`'s guard eventually folds into
  `displayPath:18` — it changes `displayPath('/')` from `'//'` to `'/'` for every consumer. Out of
  scope for this plan unless decided otherwise.
- **`workspace-edit.ts:2653` `joinRelative`.** Whether its five call sites can take the normalising
  variant. If not proven, the fourth copy stays with a comment.
- **`sortedDirents` mutation.** Keep sorting in place and document it, or copy.
- **`getDefaultLibFilePath`.** Confirm against the installed `typescript-language-service` that the
  options argument changes only the file name. If confirmed, this decision is closed, not made.

## Verify plausible failures

Vitest runs under `bun --bun vitest` in `apps/*`, plain `vitest` in `packages/*`. `apps/web` has two
socket-free projects, `node` and `dom` (`apps/web/vitest.config.ts`); `apps/server` has one
unnamed project (`apps/server/vitest.config.ts`). Never run a package-wide or repository-wide suite
for this plan.

| Failure to catch                                                      | Narrowest check                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The shared `file:` helper drifts from the editor's inverse            | New `apps/web/src/lib/tests/file-uri-parity.test.ts`, asserting the contracts helper equals `fileNameToDocumentUri` and survives a `documentUriToFileName` round trip, including a backslash input · `bun --bun vitest run --project node src/lib/tests/file-uri-parity.test.ts` |
| A `parentPath` swap crosses a behaviour family                        | A case per family in `apps/web/src/features/workspace/utils/tests/path.test.ts` covering `'/a/b'`, `'a/b/'`, `'README.md'`, and root-equals-path — the four rows of the table above                                                                                              |
| `containerTreePath` does not cover `parentTreePath`'s callers         | `apps/web/src/features/workspace/utils/tests/entry-paths.test.ts` (already asserts `'src/lib/a.ts'` → `'src/lib'` and `'a.ts'` → `''`) plus `apps/web/src/features/workspace/tests/tree-pane.test.ts`                                                                            |
| A workspace edit targeting the workspace's parent is accepted         | New case beside `apps/server/src/fs/tests/workspace-edit.test.ts` asserting `WORKSPACE_EDIT_INVALID` · `bun --bun vitest run src/fs/tests/workspace-edit.test.ts`                                                                                                                |
| A file named `..foo` still reads as outside the root                  | `apps/server/src/fs/tests/containment.test.ts` as the known-good control, then the same input through git and LSP: `bun --bun vitest run src/git/tests/service.test.ts src/lsp/tests/registry.test.ts src/lsp/typescript/tests/session.test.ts`                                  |
| Tightened `isPathInWorkspace` silently empties a result set           | `apps/web/src/features/workspace/utils/tests/path.test.ts` (empty root, trailing-slash root) plus `apps/web/src/features/search/tests/search-providers.test.ts` and `apps/web/src/features/workspace/tests/use-tree.test.ts`                                                     |
| Highlighted ranges stop matching the ranges replace edits             | `apps/web/src/features/search/tests/search-replace.test.ts` and a new `packages/contracts/src/tests/workspace-search-match.test.ts` pinning the surrogate-pair and `\p{L}\p{N}_` cases · `vitest run src/tests/workspace-search-match.test.ts`                                   |
| A dirty buffer and its on-disk twin filter differently under one glob | `apps/web/src/features/search/tests/search-providers.test.ts` and `apps/server/src/fs/tests/search.test.ts`, same include/exclude globs, same root                                                                                                                               |
| The normalising `joinRelative` changes a workspace-edit manifest path | `bun --bun vitest run src/fs/tests/workspace-edit.test.ts src/fs/tests/search-fallback.test.ts src/fs/tests/workspace-index.test.ts`                                                                                                                                             |
| The absolute-display fold changes a tab or document title             | `apps/web/src/features/git/tests/diff-document.test.ts` and `apps/web/src/features/search/tests/search-buffer-document.test.ts`                                                                                                                                                  |

Typecheck the three touched packages with their own `typecheck` script rather than a root run;
`tsgo --noEmit` in `packages/contracts`, `apps/server`, and `apps/web` is the boundary proof for the
new contracts exports.

## Stay out of these

- **The two false-twin URI bugs** at `definition-target.ts:13` and `use-open-file-reference.ts:47`
  belong to [Plan 090 regression record](../docs/duplicate-defect-regressions.md). This plan depends on them; it does not fix
  them.
- **`errorMessage`, `errorSummary`, `elapsedMs`, and error construction** belong to
  [Plan 091](091-error-and-timing-helpers.md), including the copies inside the files touched here.
- **The `use(Context)`-or-throw sweep and the store ceremony** belong to
  [Plan 093](093-web-react-and-store-ceremony.md). Do not restructure
  `features/workspace/state/event-conflict-adapter.ts` beyond deleting its `parentPath` twin.
- **Web↔TUI parallels**, including `apps/tui/src/files/utils/list.ts:58` and anything that moves a
  module into `packages/client-core`, belong to
  [Plan 094](094-client-core-web-tui-parity.md). This plan adopts client-core's existing
  `files/path.ts` export; it does not move code into the package.
- **`fsync` pairs, `lstatOptional`, `jsonEqual`, WebSocket adapters, and atomic write** belong to
  [Plan 095](095-server-plumbing.md), even where they sit in `apps/server/src/fs/workspace-edit.ts`
  alongside helpers this plan deletes.
- **`features/menus` → `keymap/menus/` and the other `apps/web` layering moves** belong to
  [Plan 096](../docs/web-layering.md).

## Completion checklist

- [ ] Plan 090's two URI fixes are on `main` before the contracts `file:` helper is adopted.
- [ ] `packages/contracts/src/file-uri.ts` exists, is re-exported from `index.ts`, and contracts still
      depends only on `minimatch` and `valibot`.
- [ ] The parity test lives in `apps/web` and pins the backslash and round-trip behaviour.
- [ ] Three `parentPath` families have three homes and three names; no call site crossed a family.
- [ ] `path-formatters.ts`'s header comment lists the `parentPath` families, the root-relative family,
      and the sixth `basename` variant.
- [ ] `isOutsideRoot` is the only containment rule on the server, and `assertInside` rejects the
      workspace's parent with a test.
- [ ] `isPathInWorkspace`'s empty-root change is recorded in a test and in the commit message.
- [ ] `isWholeWordMatch` is exported before `workspaceSearchGlobPath` is written.
- [ ] The `getDefaultLibFilePath` decision is closed by evidence, not by preference.
- [ ] Section 9.5's family is renamed and commented, not merged.
