# MDX and SQL admission follow-up

Investigated 2026-09-20. Neither language is externally blocked. The investigation below preceded admission.
Generic SQL and repaired MDX have since shipped as partial coverage. See the
[SQL increment](native-syntax-implementation.md#generic-sql-increment) and
[MDX increment](native-syntax-implementation.md#mdx-increment). The findings below record the original
upstream behavior, before the repairs. Ruby and Kotlin runtime work is deferred; Swift, Vue, SCSS
and GraphQL need builds and query integration.

## MDX

Use [srazzak/tree-sitter-mdx](https://github.com/srazzak/tree-sitter-mdx/tree/3aa29e8de1bf0213948a04fe953039b6ab73777b)
as the first repair candidate. It has an MIT license, generated parser source, JSX and Markdown
rules, highlight queries, injection queries and a small corpus. This replaces the inventory's
incorrect plain-Markdown source for MDX.

With Tree-sitter CLI 0.26.9, all five upstream corpus tests pass. Local probes expose gaps:

| Input                                                          | Native parser result        |
| -------------------------------------------------------------- | --------------------------- |
| `# {title}`                                                    | ERROR at the heading prefix |
| `Hello <Badge /> world`                                        | ERROR at the prose prefix   |
| `Hello {user.name}!`                                           | ERROR at the prose prefix   |
| Import/export with semicolons, a plain heading and a component | No ERROR                    |
| A component containing a heading and prose                     | No ERROR                    |
| A JSX fragment containing a heading and mapped JSX             | No ERROR                    |
| A SQL fence followed by a JSX comment                          | No ERROR                    |

No ERROR alone does not prove a correct tree or correct highlighting. The upstream corpus is
too small to establish MDX coverage. Repair inline JSX and expression boundaries, then assert
node ranges and final token categories for these cases. Test edits that add and remove braces,
tags and fences, plus Unicode offsets and malformed input.

The upstream queries also need work:

- Highlights use `#is-not? local`, so builtin shadowing shares the existing JavaScript locals gap.
- Injections include `#offset!` and `injection.include-children`; verify their host semantics.
- Markdown inline, YAML, TOML and fenced languages need explicit lazy dependencies.
- The whole fenced block receives `@text.literal`. Apply the existing Markdown fence treatment
  so parent coloring cannot cover injected comments and keywords.
- Compose JSX highlights and map captures before checking the actual browser worker.

If repairing the inline grammar proves impractical, evaluate another MDX-aware grammar against
the same cases. Do not substitute plain Markdown or silently switch native palettes to Shiki.

## SQL

Use [DerekStride/tree-sitter-sql](https://github.com/DerekStride/tree-sitter-sql/tree/97614d051eebfd3bc5d97c0bdb5a1638719ca811)
for generic SQL first. Its package is `@derekstride/tree-sitter-sql`, version 0.3.11 at the pinned
revision. The previous inventory paired this repository with evidence from a different npm package.

Tree-sitter CLI 0.26.9 generated the parser successfully. All 512 upstream corpus cases pass.
A local sample containing a CTE, SELECT, JOIN, CREATE TABLE and INSERT parses without errors,
and the supplied highlight query compiles.

Query execution exposes an actionable defect: `42` and `12.5` receive only `string` captures.
The numeric predicates contain Lua-style `%d` patterns under `#match?`. Adapt them to the runtime's
regex syntax and assert integer, decimal, signed, exponent and quoted-string categories.

Build WASM, map captures, and add expected-category and incremental/fresh worker fixtures for
SELECT/JOIN, CTEs, DDL, quoted identifiers, comments, strings and unfinished statements. Verify
both palettes in the app and lazy loading from a SQL Markdown fence before admission.

Generic SQL highlighting does not require complete dialect parity. Record dialect gaps explicitly
and admit as partial once the agreed fixtures pass. The installed Shiki catalog has separate `sql`
and `plsql` IDs; keep PL/SQL separate until its procedural syntax passes its own fixtures.

## Reproduction

At each pinned revision, run `tree-sitter test`; SQL first requires `tree-sitter generate`.
Write the cases above to `.mdx` or `.sql` files and run `tree-sitter parse --quiet <file>`.
For SQL categories, run `tree-sitter query queries/highlights.scm <file>`.

The investigation used native CLI parsers, not the browser WASM runtime. SQL browser admission and incremental edit checks are now recorded in the implementation notes.
MDX browser-worker admission now passes with inline grammar and scanner repairs; see the implementation notes. The wider performance checks remain. Captured probe inputs and output
are in `/work/tmp/fregat-evidence/native-syntax-mdx-sql-20260920/`.
