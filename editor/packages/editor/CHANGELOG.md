# @singapore-editor/core

## 0.2.2

### Patch Changes

- 219bebd: Inspect retained analysis sessions and reclaim inactive configurations while preserving active leases, document text and Undo history.
- 8d4694a: Route Editor commands through the shared hotkeys focus tree, export preset data, and preserve standalone widget and text replay behavior.
- 0f6a1ed: Remove an unresolved transitive dependency from the Editor browser test preoptimization list.
- dd900b4: Paint ready shared Shiki analysis in existing editor views without an additional edit debounce.
- 2fc90ad: Expose exact deduplicated token-store backing and fenced Shiki worker resource counts, with unmeasured allocations identified separately.
- 7f18c08: Preserve structural providers' range readiness when reusing document analysis, and attach completed full token results synchronously while range queries are unavailable.
- 508fa33: Expose fenced Tree-sitter worker resource counts and public retention types. Count Shiki tokenizer storage directly during inspection.
- @singapore-editor/textbuffer@0.2.2

## 0.2.1

### Patch Changes

- 8bd0e75: Stabilize delayed-readiness first-paint browser checks by awaiting the editor's highlight-settlement signal.
- @singapore-editor/textbuffer@0.2.1
