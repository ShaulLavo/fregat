# Plan 178: cleanup

- Status: PROPOSED. Size S. Last.
- Owns: removing what the other sub-plans leave behind and updating the rules that named the tree
  as an exception.

## Work

1. **Stylesheet.** `packages/tree/src/styles/style.css` is gone. So are `treeStyle`,
   `treeUnsafeCss`, `fileTreeStyle`, `--workbench-tree-*` (replaced by tree tokens), every `--trees-*` variable, and the package's `sideEffects` entry.
2. **Package.** `@workspace/tree` exports the model only. Drop `react`, `react-dom` and `zustand`
   from its dependencies, its `browser` test project, `FileTree.test.tsx`, `public-api.test.ts`.
   Its node tests stay.
3. **Census.** `web-design-census.mjs` and `react-compiler-census.mjs` roots cover the moved view;
   `packages/tree` leaves the compiler census (no React left). The allow lists hold only Q1
   exceptions, each citing it.
4. **Rules and docs.**
   - `AGENTS.md:80`: the tree follows the list rules; delete "the shadow-root file tree retains its
     own keyboard model".
   - `AGENTS.md` truncation section: `features/git/components/file-row.tsx` no longer exists; the
     reference is `components/file-label.tsx` and `components/git-file-row.tsx`.
   - `docs/pattern-layer.md:61`, `docs/web-design-language.md:43`: remove the tree's exemption.
   - `docs/pane-zoom-plan.md`: drop the shadow-root sizing contract.
   - `packages/tree/UPSTREAM.md`: Pierre's render code is no longer ported; the model and path
     store stay comparable.
   - `.agents/skills/verify-fregat/features/file-tree.md`: selectors and the harness command.
5. **Follow-ups unblocked.** Plan 128's `Activity` for `sidebar-panel.tsx`; Plan 102's scrollbar
   utility (if not already landed by [chrome](chrome.md)).

## Verification

`bun run gates`, the harness, every tree scenario, the TUI tree tests, and these greps, each empty:

- a PascalCase or camelCase file name under `packages/tree/src` or the moved tree files in
  `features/workspace` (rule 7);
- a file over about 500 lines among them without a recorded reason;
- `data-file-tree-`, `data-item-`, `--trees-`, `FLATTENED_PREFIX`, `FileTreePublicId`,
  `preparePresorted` anywhere in the repo;
- a second `DndContext` in `apps/web/src`;
- a file-order comparator or filter matcher outside the shared ones [helpers](helpers.md) names,
  unless it carries the reason it differs.
