# Browser Code Editor — Architecture

## 1. Goals

- Ultra-low latency typing (target: <1-2ms perceived)
- Fully in-browser editor
- Heavy use of Web Workers
- Modular, decoupled architecture
- High performance on large files (MBs, long lines)
- High flexibility (future plugins, languages, features)

---

## 2. Non-Goals (for now)

- Collaboration (CRDT/OT) — maybe later
- Full IDE features (LSP, etc.)
- Accessibility completeness
- Mobile-first UX

---

## 3. Core Principles

- Single canonical document model
- Everything else = derived projections
- Strict sync vs async split
- Minimal work on main thread
- Eventual consistency for non-critical systems
- Piece-based thinking (not whole document)

---

## 4. High-Level Architecture

### Main Thread (Sync / Immediate)

- Input handling
- Caret & selection
- Minimal text echo
- Browser-owned layout for mounted rows
- 2D viewport virtualization
- Rendering / DOM / CSS highlights
- Reconciliation with worker

### Worker(s) (Async / Authoritative)

- Document model
- Transactions / edits
- Tree-sitter syntax parsing
- Decorations
- Scheduling

---

## 5. Core Systems

### 5.1 Document Engine (Locked)

Piece table on a persistent AVL tree with immutable snapshots.

See: [Storage: Piece Table](docs/storage/piece-table.md) for full design.
Implementation: `packages/textbuffer/src/`

---

### 5.2 Transaction System

Batch edit API designed. Full transaction format still open.

See: [Editing: Selections & Undo](docs/editing/selections-and-undo.md) for batch edits.

**Open:** Full transaction format, where undo/redo lives (main vs worker).

---

### 5.3 Position Model (Locked)

Three-tier: Offset (UTF-16) -> Point (row/column) -> Anchor (durable buffer reference).

See: [Positions: Types & Conversions](docs/positions/types-and-conversions.md)
See: [Positions: Anchors](docs/positions/anchors.md)

---

### 5.4 Layout System

The editor will not build a parallel text layout engine. Browser layout is the visual source of
truth for mounted text.

See: [Browser Layout + 2D Virtualizer](docs/display/browser-virtualization.md).

**Key principles (locked):** native browser layout, custom viewport virtualization, CSS Highlight
API for current selection/syntax paint, and DOM `Range`/caret APIs for geometry on mounted content.

**Implemented:** projected text-row input, fixed-height vertical virtualization, FoldMap integration,
and conservative horizontal chunking for eligible long rows. **Open:** variable-height row producers,
complete horizontal windowing for measurement-refusal rows, and the worker/main ownership boundary
for viewport inputs.

---

### 5.5 Sync vs Async Split

**Open:** How much layout on main, optimistic behavior scope, reconciliation strategy.

---

### 5.6 Invalidation Model

Display transform invalidation protocol designed. Virtual row/chunk invalidation still open.

See: [Display: Transforms](docs/display/transforms.md) for the invalidation protocol.

---

### 5.7 Syntax Tree System (Committed)

Tree-sitter is the canonical syntax engine. It replaces Shiki as the long-term source of syntax data.

See: [Syntax: Tree-sitter](docs/syntax/tree-sitter.md)

**Locked:**

- Parse state is a derived projection over a specific `PieceTableSnapshot`.
- All Tree-sitter parser creation, parsing, incremental reparsing, and query execution runs in workers.
- The main thread never loads grammars, owns parse trees, walks syntax nodes, or runs Tree-sitter queries during typing.
- The main thread only consumes snapshot-tagged syntax outputs: highlight decorations, fold ranges, structural-selection ranges, indentation hints, and bracket/tag match ranges.
- Worker-side Tree-sitter queries drive highlights, folds, structural selections, bracket/tag matching, indentation, language injections, and outline-style features.
- Selection behavior may be syntax-native, but active selections are stored as anchors so they survive stale parses, syntax errors, unknown languages, undo/redo, and snapshot changes.
- Syntax decorations emitted from Tree-sitter must not allocate one anchor per token/node.

**Open:** worker protocol, parser package loading, query asset format, edit-to-parser input bridge, parser memory limits, and snapshot retention policy for parse trees.

---

### 5.8 Scheduling System

Designed as a two-level scheduler: a small main-thread frame scheduler for input, mounted-row DOM
work, and viewport reconciliation, plus a worker-side document scheduler for serialized
transactions and derived projections.

**Locked:** typing is never queued behind derived work; document transactions are serialized per
document; syntax, folds, decorations, and background analysis are snapshot-tagged, coalesced, and
stale-droppable.

**Open:** worker topology, exact pressure thresholds, and whether undo/redo ownership moves fully
into worker transactions.

---

### 5.9 Decoration System

Constraints defined, design deferred. Dense decorations must not use per-token anchors.

See: [Display: Transforms](docs/display/transforms.md) for decoration constraints.

---

### 5.10 Viewport & Virtualization (Implemented)

The virtualized view mounts projected text rows around the viewport and delegates glyph layout,
BiDi caret geometry, hit testing, and selection rectangles to the browser. See
[Display: Browser Virtualization](docs/display/browser-virtualization.md).

---

### 5.11 Rendering Layer (Partially Implemented)

CSS Highlight API renderer implemented. See `packages/editor/src/editor.ts`.

---

### 5.12 Extension System (In Progress)

Extensions run through a host lifecycle with explicit `install`, `activate`, `update`,
`deactivate`, and `dispose` hooks. The public surface is `@singapore-editor/core/extensions`; consumers get
power through typed domain registries instead of a broad editor service locator.

**Public contribution APIs:**

- Commands
- Capabilities
- Edit helpers
- Decorations
- Gutters
- Injected rows
- Syntax and highlighters
- View contributions

`EditorViewContribution` is the public escape hatch for features that genuinely need mounted DOM
access or viewport snapshots. Domain features should prefer their registry before using a view
contribution.

**Internal-only migration bridge:** `EditorPluginHost`, host events, `EditorInternalPluginContext`,
and the broad `EditorFeatureContribution*` context are implementation/test surfaces. They are exposed
through internal/testing entry points only while first-party features finish migrating to domain
registries.

**Locked:**

- Public plugins do not receive `registerEditorFeatureContribution`.
- Contribution conflicts fail near registration: duplicate command handlers, duplicate gutter ids,
  and duplicate row-decoration source ownership are rejected.
- Contribution factory, `update()`, and disposal failures are contained and logged so one extension
  does not break unrelated editor systems.
- Each plugin has its own context; what a plugin or a contribution registers is released with it,
  including registrations made after `activate` or after the contribution was created.

Every hook, its scope, ordering and stability label (supported, experimental, internal) is in the
[extension hook contract map](docs/architecture/extension-hooks.md).

**Open:** migrate the remaining first-party feature bridge users to public domain/view APIs, then
delete the broad internal feature contribution bridge.

---

## 6. Data Flow

### Typing Flow (Target)

1. Input event (main)
2. Minimal text update (main)
3. Browser lays out mounted rows
4. Paint immediately
5. Send edit to worker
6. Worker updates document-derived projections
7. Worker sends authoritative result
8. Main updates visible row/chunk window and reconciles

---

## 7. Remaining Open Questions

1. ~~Position model?~~ **Locked.**
2. ~~Text storage structure?~~ **Locked.**
3. Virtual row/chunk model?
4. ~~Invalidation strategy?~~ **Partially designed.**
5. Main vs worker virtualization split?
6. ~~Scheduler design?~~ **Locked at contract level.**
7. Decoration system design?
8. Tree-sitter parser/query loading and memory policy?
9. ~~Extension service locator?~~ **Replaced with typed domain registries; internal bridge pending
   deletion.**
