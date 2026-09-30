# Shiki token representation

Plan 112's application trace identified Shiki as the dominant worker at 15 MiB: about 2.38 GB
of JS heap, versus about 19 MB in Tree-sitter. Inspection found a fresh pair of accessor closures
on every retained themed token. Millions of these object literals retained separate getter/property
storage even though every getter performed the same lookup into a shared scope style.

`ScopedToken` now shares accessor functions. Own enumerable `color` and `fontStyle` properties use
those same functions on every token, preserving `Object.keys`, JSON, spread and dynamic recoloring.
Private style references keep implementation data out of public token enumeration. Lexical state,
source text and token coverage are unchanged. This fixes representation overhead; it does not
introduce a partially parsed document or a bounded viewport tokenizer.

Run from the Editor root:

```sh
node examples/stress/shiki-memory.ts --output /work/tmp/editor-shiki/result.json
```

The Chromium experiment creates the real TypeScript tokenizer and retains it over repeated indented
functions. It changes the theme after tokenization and verifies the first token's color changes.
CDP collects garbage before each heap reading. The tokenizer runs in the page isolate here to
measure the token representation directly; Platform's integration trace measures its actual worker.

| Text  |  Tokens | Control retained JS heap | Candidate retained JS heap |
| ----- | ------: | -----------------------: | -------------------------: |
| 1 MiB |  370080 |                143.1 MiB |                   28.8 MiB |
| 5 MiB | 1850424 |                707.0 MiB |                  135.2 MiB |

The 5 MiB retained heap falls by 81%. Both arms retain about 2 MiB of backing storage. Tokenization
at 5 MiB took 6.09/6.23s, so this experiment makes no CPU improvement claim. After disposal both
arms return to about 1.8 MiB JS heap. Raw [control](e112-results/shiki-before.json) and
[candidate](e112-results/shiki-after.json) results record all heap fields and browser version.

Correctness coverage compares every painted character against Shiki across TypeScript, TSX, HTML
and Markdown in five themes, verifies retained tokens recolor without reparsing, then applies an
incremental edit and compares again. Enumeration and JSON checks protect the accessor contract.
The real worker suite checks packed tokens, incremental edits, theme changes and disposal.

Shiki still retains complete line tokens and grammar states. It also rebuilds its line array and
text string on edits. Those costs remain measurable; this change removes the per-token closure
and property-table multiplication that dominated the observed worker memory.
