# Structured And Semantic Search Evaluation Plan

Status: draft

This plan covers evaluating side candidates for search modes that are not normal workspace text grep. The candidates are `ast-grep` for structural code search and `qmd` for semantic/docs-style retrieval.

These should not replace workspace text search. They are separate search modes with different product promises.

## Candidates

- `ast-grep`: structural search, linting, and rewriting over syntax trees.
- `qmd`: local docs/knowledge-base search with BM25, vector search, hybrid query expansion, reranking, and AST-aware chunking for some code files.

Candidate URLs:

- https://github.com/ast-grep/ast-grep
- https://github.com/tobi/qmd

## Product Boundary

Normal workspace search answers:

- "Where does this exact text or regex occur?"
- "Show me matches with file, line, range, and preview."

Structural search answers:

- "Where does this syntactic pattern occur?"
- "Find calls shaped like `$A && $A()`."
- "Find React hooks called conditionally."
- "Find a code pattern even when whitespace or formatting differs."

Semantic search answers:

- "Where is auth explained?"
- "Which files discuss workspace indexing?"
- "Find code/docs related to terminal process lifecycle even if those exact words are missing."

These modes should be explicit. Do not make semantic or structural search silently affect exact workspace search results.

## AST Search With `ast-grep`

### Goals

- Add an opt-in structural search mode.
- Search by syntax pattern rather than text regex.
- Return file/range/previews compatible with the existing result UI.
- Support a small set of languages first, likely TypeScript, TSX, JavaScript, JSX, Python, Go, and Rust.

### Non-Goals

- Replacing text search.
- Running structural search on every normal query.
- Building a global AST index in v1.
- Automatic rewriting in the first evaluation.
- Lint-rule management UI.

### Evaluation Questions

- Can `ast-grep` produce stable JSON output with path, range, and match text?
- How fast is it on this repo and a larger workspace?
- How does language detection work?
- Can we restrict by include/exclude globs?
- Can it be cancelled quickly?
- How does it behave on parse errors?
- Can it search multiple languages in one request, or do we need per-language runs?
- Does it respect `.gitignore` or do we need to feed candidate paths?
- Can it support future rewrite flows safely?

### Integration Shape

Use `ast-grep` as a provider, not an index.

Initial flow:

1. User selects structural search mode.
2. UI accepts a structural pattern and language selection.
3. Server runs `ast-grep` over workspace candidates.
4. Results normalize into `WorkspaceSearchEvent`.
5. Existing result tree/search-buffer UI displays matches.

Optional later flow:

1. Workspace path index supplies candidate files by language and glob.
2. `ast-grep` runs only on those candidates.
3. Structural replace/rewrite is added as a separate, guarded operation.

### Benchmark Queries

TypeScript/TSX:

- Find function calls: `$FN($ARG)`
- Find conditional hook-like calls.
- Find `useEffect` with empty dependency array.
- Find object spread in props.
- Find `as const` assertions.

Rust:

- Find `unwrap()` calls.
- Find `match` expressions with wildcard arms.
- Find function definitions with `async`.

Python:

- Find bare `except`.
- Find `async def`.
- Find calls to a given decorator shape.

### Acceptance Criteria

- Structural search returns precise ranges.
- Unsupported languages are reported clearly.
- Parse errors do not fail the whole search.
- Cancellation works.
- Result UI can open matched source ranges.
- Performance is acceptable for explicit structural-search mode.

## Semantic Search With `qmd`

### Goals

- Evaluate whether `qmd` is useful for docs/code knowledge retrieval.
- Keep it separate from exact workspace grep.
- Use it as a candidate for agent/context search or a "semantic search" mode.

### Non-Goals

- Replacing ripgrep.
- Replacing workspace path search.
- Running models in the normal exact search path.
- Returning semantic guesses as exact line matches.
- Building a product UI before the retrieval quality is understood.

### Evaluation Questions

- What does indexing cost on this repo?
- What files does it support well?
- Can indexes live outside the workspace?
- Can it operate fully local without unexpected network calls?
- What model downloads are required?
- What are memory and disk requirements?
- How fast are BM25-only, vector-only, and hybrid modes?
- Can results be traced back to source file and chunk ranges?
- How good are results for code questions versus docs questions?
- Can the app control privacy-sensitive paths?

### Integration Shape

Treat `qmd` as a retrieval provider.

Result shape should be chunk/document oriented:

- path
- chunk title or heading
- score
- snippet
- source range if available
- retrieval mode

Do not force it into line-match semantics. If the existing result tree cannot represent semantic chunks cleanly, build a separate result surface later.

### Evaluation Dataset

Use mixed query sets:

Docs-oriented:

- "workspace search performance"
- "file picker system search"
- "how replace in files works"
- "terminal process lifecycle"
- "workspace indexing plan"

Code-oriented:

- "where dirty buffers override disk search"
- "filesystem watcher event handling"
- "search route SSE streaming"
- "metadata stored for recent files"
- "how ignored paths are filtered"

Ambiguous/natural-language:

- "why search feels slow"
- "what handles binary files"
- "where to add file kind detection"
- "how to benchmark indexed grep"

### Acceptance Criteria

- Local-only behavior is verified.
- Index storage is app-owned or configurable.
- Retrieval output maps back to files and useful snippets.
- BM25-only mode is usable without model setup.
- Vector/hybrid modes provide enough quality lift to justify model/runtime cost.
- Results are useful for agent context or a dedicated semantic search surface.

## Shared Evaluation Harness

Build a small evaluation harness that records:

- Candidate tool and version.
- Workspace root.
- Index location.
- Index build time.
- Query mode.
- Query latency.
- Top results.
- Memory/disk notes.
- Failure mode.

For `ast-grep`, include:

- Language.
- Pattern.
- Match count.
- Parse-error count if available.

For `qmd`, include:

- Retrieval mode: BM25, vector, hybrid.
- Model names and sizes if used.
- Chunk count.
- Top-k scores.

## Recommended Order

1. Evaluate `ast-grep` CLI JSON output and range quality.
2. Add a temporary structural-search adapter if the CLI output is clean.
3. Evaluate `qmd` BM25-only mode.
4. Evaluate `qmd` vector/hybrid mode only after confirming model/runtime cost.
5. Decide whether either candidate deserves product UI work.

## Risks

- Structural search can look like text search but has very different query syntax.
- Structural replace is powerful and needs separate safety checks.
- Semantic search can produce plausible but non-exact answers.
- Model downloads and local inference can create unacceptable startup or disk cost.
- Chunk-level semantic results may not fit the existing line-match UI.

## References

- `ast-grep`: https://github.com/ast-grep/ast-grep
- `qmd`: https://github.com/tobi/qmd
- Existing workspace search UI: `apps/web/src/features/search`
- Existing server search path: `apps/server/src/fs/search.ts`
