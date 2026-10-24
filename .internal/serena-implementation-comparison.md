# What Platform can learn from Serena

Reviewed 2026-09-11. Platform baseline: `eb926925427022c99e44fb2a2b8fbe582550bdbc`, including existing
working changes. Serena baseline: `701e7c843f46c6a649203a488cece1bf19f1df90` in `references/serena`.
This is source analysis, not a measured performance comparison. Reproduce measurements through C0
and C8 of [Plan 088](../plans/088-native-code-intelligence.md).

[Plan 087](../plans/087-stateless-mcp.md) owns MCP support. Plan 088 owns the complete native
code-intelligence feature. This document explains the implementation choices behind those plans.

## The useful idea is an agent-oriented semantic API

Serena lets an agent address code by symbol name, retrieve a definition without a whole file, and
read references in their containing symbols. Its compact answers and explicit editing tools reduce
how much low-level navigation the agent must coordinate. Platform already owns editor documents,
language-server processes, and transactional edits. The opportunity is to put a well-designed domain
API above those services and improve the services where the comparison exposes weaknesses.

The native design owns query meaning, document views, result completeness, and edit transactions.
MCP is the agent-facing protocol adapter. Editor commands call the same domain services directly.
There is no Serena runtime dependency or duplicate compiler process pool.

## Capability coverage differs by backend

The following distinguishes the open-source LSP implementation from functionality delegated to the
paid JetBrains plugin. Python wrappers for the plugin are present in the clone; the IDE engine is not.
Evidence: [Serena README](../references/serena/README.md),
[symbol tools](../references/serena/src/serena/tools/symbol_tools.py), and
[JetBrains tools](../references/serena/src/serena/tools/jetbrains_tools.py).

| Capability                                       | Serena LSP backend              | JetBrains addition                          | Native plan |
| ------------------------------------------------ | ------------------------------- | ------------------------------------------- | ----------- |
| Symbol search, outlines, bodies, references      | Implemented                     | IDE-backed resolution and dependency search | C2          |
| Declarations and implementations                 | Implemented with backend limits | Broader IDE resolution                      | C2/C5       |
| Type hierarchy                                   | Not exposed by LSP tools        | Implemented through plugin                  | C5          |
| File/symbol diagnostics                          | Implemented                     | IDE inspections and inspection catalog      | C3          |
| Definition replacement and insertion             | Implemented                     | IDE implementation                          | C4          |
| Symbol rename and reference-checked deletion     | Implemented                     | File/directory rename and IDE safe deletion | C4          |
| Move, inline, propagated deletion                | Not supplied by LSP tools       | Implemented through plugin                  | C5          |
| Debugging                                        | Not supplied by LSP tools       | Debugger REPL                               | C7 via DAP  |
| File/text tools, commands, project configuration | Implemented                     | Not required                                | C2/C4/C6    |
| Memory and onboarding                            | Implemented                     | Not required                                | C6          |

The full native program includes equivalents for the advanced capability families. It does not
promise every operation on every language. Capability discovery and a tested support matrix are
part of the feature, not a footnote after implementation.

## Compare mechanisms and choose improvements

### Symbol identity needs both convenient queries and precise references

Serena's `NamePathMatcher` accepts leaf names, nested suffixes, absolute name paths, substring matches,
and overload indices. `find_unique` rejects ambiguity. These are useful agent inputs. See
[symbol.py](../references/serena/src/serena/symbol.py).

An overload ordinal is not durable identity after edits. Our result should include a resolved
reference with workspace, document revision, backend generation, and declaration discriminator.
Keep identifier selection, full definition, and safe edit boundaries separate. Our current TS
[document-symbol handler](../apps/server/src/lsp/typescript/handlers/document-symbol.ts) uses the
first navigation span and assigns the whole range to `selectionRange`. That needs correction before
agents can rely on it for rename or body editing.

### Incremental indexing can improve on recursive collection

Serena workspace search calls `request_full_symbol_tree`, which traverses project files and obtains
cached document symbols. Its raw/normalized caches track content hashes and backend normalization
fingerprints. This is more substantial than a thin `workspace/symbol` wrapper. See
[solidlsp/ls.py](../references/serena/src/solidlsp/ls.py), especially `request_full_symbol_tree`,
document-symbol caching, and cache serialization.

Adopt that invalidation discipline. Use our existing file inventory and change events to maintain
per-file index entries, prefer useful backend workspace queries, and avoid a new complete traversal
on each symbol search. Index generations must account for branch, dependency, configuration, and
backend changes as well as file content. The expected benefit needs cold/warm/edit measurements;
source inspection alone does not establish that we will be faster.

### References should explain where the use occurs

Serena's `request_referencing_symbols` maps locations to containing symbols, with file-level fallback.
Its tool adds nearby source lines. This is more useful than handing an agent unlabelled coordinates.
See [symbol_tools.py](../references/serena/src/serena/tools/symbol_tools.py) and
[solidlsp/ls.py](../references/serena/src/solidlsp/ls.py).

Group our results by file, fetch each outline once, and use an interval lookup for the smallest
containing symbol. Preserve unresolved locations. Do not reproduce the reference's unreliable
Python-specific line heuristic. Keep references separate from call edges: an import, type use, or
assignment is not necessarily a call.

### Budgets belong inside query execution

Serena filters by path, kind, depth, body inclusion, and match count. It progressively shortens
references from snippets to locations to counts. `Tool._limit_length` applies its final character
limit after constructing output. Hover batches also have time budgets. See
[tools_base.py](../references/serena/src/serena/tools/tools_base.py) and
[symbol.py](../references/serena/src/serena/symbol.py).

Keep progressive disclosure, but bound collection as well as serialization. Return typed pages,
coverage, and a continuation or narrowing instruction. “No matches” must be distinguishable from
“index incomplete,” “backend unsupported,” and “budget exhausted.” Character counts are not token
counts; benchmark both without claiming tokenizer-independent precision.

### The shared LSP pool is not the document authority

Platform's [LspSessionPool](../apps/server/src/lsp/proxy-session.ts) already shares backend processes
and tracks per-owner versions. However, attaching an owner with different text can replace the
backend text, and later owner changes can replace it again. A hidden agent LSP client opening disk
content would therefore risk analyzing a different view from the user.

Preserve [WorkspaceDocumentService](../apps/web/src/features/editor/state/workspace-document-service.ts)
as the browser buffer authority. Add explicit versioned overlay publication and native backend
requests. Resolve disk/editor views before analysis. Conflicting owners need an explicit conflict
or isolated analysis context, not “whichever text arrived last.” This improvement also benefits
multiple editor windows independently of agent tools.

### Our transaction machinery is worth preserving

Serena's `_save_edited_file` writes to disk directly. Its rename application applies operations
sequentially, and its bulk replacement can write earlier files before a later failure. Its previews,
occurrence IDs, and expected-count guards are useful interaction ideas, but they do not provide our
editor's transaction semantics. See [code_editor.py](../references/serena/src/serena/code_editor.py)
and [file_tools.py](../references/serena/src/serena/tools/file_tools.py).

Platform already has [WorkspaceEditService](../apps/web/src/features/editor/state/workspace-edit-service.ts)
and the server [WorkspaceEditController](../apps/server/src/fs/workspace-edit.ts), backed by journals,
version checks, operation IDs, undo/redo, and recovery. The missing piece is server-initiated
coordination with editor participants. Extract shared planning and extend that path. Do not add an
MCP file writer or assume the server can call a web-owned service directly.

### Diagnostics need an honest freshness contract

Serena supports file and symbol diagnostics, including diagnostics in referencing symbols. It tries
pull diagnostics and can use published results. Its automatic post-edit comparison is explicitly
disabled in `EditingToolWithDiagnostics`, so we should not mistake the surrounding context-manager
code for active behavior. See [symbol_tools.py](../references/serena/src/serena/tools/symbol_tools.py),
[tools_base.py](../references/serena/src/serena/tools/tools_base.py), and
[solidlsp/ls.py](../references/serena/src/solidlsp/ls.py).

Our proxy strips published diagnostic versions, and our TS initializer advertises a diagnostic
provider without matching pull request handlers. Fix the capability/provenance contract first.
Validate a completed transaction or an explicit request; an intermediate edit can intentionally
break syntax. Empty cached diagnostics must never imply a verified clean result.

### Advanced refactors require language implementations

Serena OSS safe delete checks references. That does not prove absence of dynamic, reflective, or
external use. Move, inline, and propagated deletion rely on its JetBrains backend. Our current TS
[code-action handler](../apps/server/src/lsp/typescript/handlers/code-action.ts) is limited to
diagnostic code fixes, so advanced refactoring is real implementation work.

Use supported compiler/LSP refactor APIs and add language-owned transformations where needed.
Keep each transformation behind capability discovery, source revision checks, and transactional
preview. Model coverage and blockers instead of promising universal “safe” deletion.

### Memory and guidance should reuse project identity

Serena's memory service has topic paths, project/global scope, readonly and ignore policy, and
reference updates on rename. Cross-project queries restrict tools to reads. See
[memory_manager.py](../references/serena/src/serena/memories/memory_manager.py),
[query_project_tools.py](../references/serena/src/serena/tools/query_project_tools.py), and
[workflow_tools.py](../references/serena/src/serena/tools/workflow_tools.py).

Adopt versioned knowledge and explicit scope. Use Platform project/worktree identity and the settings
registry instead of Serena's mutable active-project state and layered YAML configuration. Generate
tool guidance from the actual catalog. Memory remains a small service; a full notes graph is not
a prerequisite for storing useful project knowledge.

### Streamable HTTP alone does not prove stateless MCP

Serena's [MCP factory](../references/serena/src/serena/mcp.py) constructs Python FastMCP without an
explicit stateless HTTP option and retains an agent/project context across HTTP clients. Its
support for a `streamable-http` transport therefore does not establish conformance to the requested
stateless revision. This review did not run a wire-level protocol test against Serena.

Our target is explicitly MCP `2026-07-28`, with SDK v2 configured for modern requests. Transport
requests are independent; documents, indices, operations, and debuggers remain native application
resources addressed by explicit IDs. [Official versioning specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning).

## Architecture alternatives

| Candidate                                                     | What it hides                                                            | What it exposes or duplicates                                                  | Decision                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| Embed Serena as the native engine                             | Broad language-tool implementation                                       | Separate Python/runtime/configuration, analysis state, and write path          | Does not meet the native implementation requirement |
| Attach an internal LSP client through the current socket pool | Existing wire routing                                                    | Socket ownership, dirty-document replacement, browser-specific edit provenance | Reject for the full design                          |
| Build a separate native semantic stack                        | Agent API internals                                                      | Duplicate compiler lifecycle, index, document truth, and transactions          | Reject duplication                                  |
| Add a domain API above shared native services                 | Backend choice, snapshots, queries, result budgets, and prepared changes | Explicit scope, intent, and outcomes only                                      | Selected                                            |

The selected design combines the native ownership proposal with Serena's stronger retrieval
ergonomics. It accepts a larger initial extraction in exchange for one implementation usable by
both agents and editor commands. Backend state remains long-lived even though MCP handlers are
per-request. That distinction prevents the transport requirement from causing repeated indexing
or repeated language-server startup.

## What remains to prove

No benchmark, provider compatibility run, or native implementation was performed for this plan.
The first implementation gates must prove SDK/provider wire support, capture real backend
capabilities, and calibrate correctness/performance fixtures. Later gates must prove divergent
document handling, participant recovery, primary-language advanced refactors, and DAP behavior.
The plans name these as completion requirements rather than assumed properties.
