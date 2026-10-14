# Markdown reference fixtures

These assets are development and regression data. They are not held-out evaluation.
Tests consume them offline; no local reference checkout or production state is required.
`manifest.json` records their original revisions, licenses, counts and SHA-256 hashes.

`commonmark.json` contains all 652 examples extracted from `commonmark-spec@0.31.2`.
The specification is by John MacFarlane and contributors, licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The derived example data retains that license.

`gfm.json` contains all 672 examples in the GitHub Flavored Markdown specification
bundled by the pinned tree-sitter-md revision, including the inherited CommonMark examples.
The specification is by John MacFarlane, GitHub and contributors, licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Its inherited CommonMark version is 0.29. Record disagreements with the newer CommonMark
profile individually rather than combining their denominators.

`chat.json` and `repositories.json.gz` come from the already-published tree-sitter-md
regression corpus at the revision in the manifest. That repository is MIT licensed.
The upstream corpus README records the owner's authorization to publish the 183 recovered
assistant messages. The repository snapshot has 497 Markdown files from the pinned Fregat
and Editor revisions. See the original provenance in
[the upstream corpus README](https://github.com/ShaulLavo/tree-sitter-md/blob/e2ae3f735f614b3b618b5de71fc41644a180b9e7/bench/corpus/README.md).

The reference oracle parses specification output as inert HAST data. It compares decoded
text, nesting, attributes and meaningful whitespace before product sanitization. Its raw
HTML output is never inserted into a document. Product-safe display has separate tests.
The oracle performs no rendering, network fetching, script execution or host activation.
