# Architecture

Singapore keeps one canonical document on the main thread. Visible text, syntax, folding and the minimap are projections of that document. A projection carries the version it describes so an old worker answer can be recognized.

## The synchronous path

Input reaches the editor, which applies text edits to the document and updates the caret and selection. The persistent piece table returns a new version. The virtualizer chooses the rows and eligible long-line chunks needed by the viewport. The browser lays out the mounted text.

The editor uses DOM ranges and browser caret APIs for geometry on that mounted text. It avoids maintaining a second complete text-layout engine.

## The asynchronous path

Workers handle derived work. Tree-sitter parses syntax and injections, Shiki tokenizes text, the minimap draws an OffscreenCanvas, spellcheck processes words and TypeScript runs its language service. Each worker owner controls transport, retained state and disposal.

A worker can lag behind typing. The main-thread document remains the text authority while those projections catch up. The Workers concept page describes the ownership boundary.

## Versions and features

Persistent versions let a reader keep a stable document while later edits create a new one. Anchors resolve durable positions against a chosen version. Plugin contributions read the input types they need and publish presentation or commands through the core contracts.

Rows have fixed height today. Variable-height rows and complete long-line horizontal handling remain work in progress. Measure each file and plugin against the editor's performance budget.

## Engineering sources

The [architecture document](https://github.com/ShaulLavo/fregat/blob/main/editor/ARCHITECTURE.md) contains design goals and open decisions. Some early sections describe future worker ownership. The [worker topology](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/architecture/worker-topology.md) records current ownership, including the main-thread canonical document.
