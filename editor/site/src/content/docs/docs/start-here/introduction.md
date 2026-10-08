# Introduction

Singapore is a browser code editor. Mount the core on an HTML element, give it text, and add the packages your application needs.

The core handles editing, selections, undo, folding and virtualized text rows. Optional packages add tree-sitter highlighting, language servers, gutters, find, a minimap, diff views and framework adapters.

This page is a Markdown file open in Singapore. On a desktop browser you can select, search and edit it. Edits stay in this browser tab.

## What makes it different

Each text edit produces a new version of a persistent piece table. Old versions share unchanged tree nodes and remain readable. Stable anchors refer to buffer positions and track edits.

The browser lays out visible text. Singapore paints syntax colours with the CSS Custom Highlight API. Workers handle derived work such as parsing, highlighting, the minimap, spellcheck and the TypeScript language service. The canonical document stays on the main thread.

## Choose an integration path

Start with the [quick start](quick-start.md). It mounts an editor and shows the source that does it. Its [troubleshooting section](quick-start.md#if-it-doesnt-work) covers the usual first problems. The [React and Solid guide](../guides/frameworks.md) shows each framework's adapter.

The [Monaco](monaco.md) and [CodeMirror](codemirror.md) migration pages map familiar APIs to Singapore and list the differences to check before moving an application.

## Current limits

The public API is still changing. Screen-reader accessibility has no published audit, and mobile and touch are outside the current target. Rows have fixed height. Syntax colours use `::highlight()`, which cannot set font weight or font style.

Monaco has VS Code's language ecosystem and a longer record of editor edge cases. CodeMirror has a small core and a large extension ecosystem. Singapore requires worker and WebAssembly asset hosting when you add tree-sitter. Choose based on the features and browser support your application needs.

There is no published editor-level benchmark proving Singapore faster than either editor. The [performance page](../concepts/performance.md) explains the measurements to run for your own workload.

## Source and roadmap

Development happens in [Fregat](https://github.com/ShaulLavo/fregat/tree/main/editor). The [Singapore repository](https://github.com/ShaulLavo/singapore) is a read-only mirror. Submit contributions to Fregat and follow the [roadmap](https://github.com/ShaulLavo/fregat/blob/main/PLAN.md).
