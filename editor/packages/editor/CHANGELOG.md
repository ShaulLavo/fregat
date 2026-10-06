# @singapore-editor/core

## 0.2.6

### Patch Changes

- 5670c3d: Own source delivery and contribution lifetimes in document analysis. Use typed structural and highlighter operations with immutable worker reads, preserve exact pinned work, and reject partial diff sources before syntax preparation.
- @singapore-editor/textbuffer@0.2.6

## 0.2.5

### Patch Changes

- 832e149: Keep current highlight readiness pending across provider and theme replacement overlaps until the current result is accepted, while preserving rebased styles.
- fd035f2: Prepare the ordered provider theme with retained highlighter results so compatible ready documents attach synchronously without another constructor theme request.
- 51d2a71: Keep word-wrap choices in retained logical editor views across native editor remounts.
- @singapore-editor/textbuffer@0.2.5

## 0.2.3

### Patch Changes

- 9d726b3: Release optional active syntax range history using each view's actual token and fold contributors. Preserve shared requests and warm current-frame readiness while preventing canceled optional replies from restoring discarded caches.
- 33e949e: End rendering when height, gutter, or inline widget callbacks dispose their editor. Release late cells and widgets, finish owned cleanup after callback errors, and preserve live atomic viewport completion.
- 4e053fc: Track displayed structural ranges and preparation pins separately from cancelable query waiters. Release original preparation interest during view handoff, report promoted pending stages as stale, and stop failed highlighter replacement after terminal reentrant disposal.
- d297a23: Notify retention subscribers after analysis entry, lease, display demand and query changes settle. Detach subscriptions before terminal provider disposal.
- 5365760: Preserve optional syntax warming suppression across compatible view attachments after discarded history is retired.
- @singapore-editor/textbuffer@0.2.3

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
