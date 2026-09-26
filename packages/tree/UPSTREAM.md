# Tree package upstream and local boundary

`packages/tree` is a local, product-owned fork of Pierre's tree and path-store packages. Upstream
changes are reviewed as behavior and ported manually into the local architecture. Do not restore a
submodule, copy upstream files wholesale, or mirror upstream exports automatically.

## Provenance

| Fact                          | Value                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Original fork                 | <https://github.com/ShaulLavo/pierre.git>, branch `codex/tree-drag-selection` |
| Imported fork commit          | `89a601652175d1a79d3bd991b71ee6b9022a2884`                                    |
| Fork merge base with Pierre   | `af02e6ddbb4a9d327581942682493bcdf687857f`                                    |
| Upstream repository           | <https://github.com/pierrecomputer/pierre>                                    |
| Local in-repository copy      | platform commit `ed75f3c559b881ad2c933a095d23312ec6401d0f`                    |
| Last audited upstream         | `55a941914056af44c78c4ba607b37130f189fb70`, 2026-08-20                        |
| Local behavior reconciliation | platform commit `2f4ad859f214f0095368d405301ee26d73d16adf`                    |

The local path map is:

| Pierre                                       | Local                             |
| -------------------------------------------- | --------------------------------- |
| `packages/trees/src/render/FileTreeView.tsx` | `src/components/FileTreeView.tsx` |
| `packages/trees/src/render/*`                | `src/utils/render/*`              |
| `packages/trees/src/model/*`                 | `src/utils/model/*`               |
| `packages/trees/src/components/*`            | `src/components/*`                |
| `packages/trees/src/utils/*`                 | `src/utils/*`                     |
| `packages/path-store/src/*`                  | `src/utils/path-store/*`          |

## Reconciled upstream behavior

The 2026-08-20 audit applied or characterized these upstream fixes locally:

- `e58bc4b4`: whitespace-safe overflow splitting.
- `02d5352c`: generic file-icon remap fallbacks.
- `37e7ef05`: stable initial-snapshot behavior across resubscription.
- `03e5a01e`: presorted directory/descendant construction invariant.
- `6fc8db55`: IME-safe rename Enter/Escape handling.
- `1238547a`: interactive search collapse behavior, merged with the local `close`/`retain` policy.

The audit deliberately did not port unreachable public forwarding APIs, arbitrary-color decoration
parts, Pierre theming/build/release integration, or the unmeasured SoA count representation. Future
reviews start at the last-audited SHA above, use a disposable checkout, and record each tree or
path-store change as applied, already local, skipped, deferred, or irrelevant.

## Product capabilities consumed locally

The workspace file navigator now uses the package for:

- virtualized rendering, compact density, icons, selection, item handles, expansion, and lifecycle;
- drag/drop validation and multi-move, inline rename/create, row decorations, and context menus;
- retained inline search with query, match count, previous/next, clear, close, and input focus;
- explicit DOM focus, nearest-path reveal, and virtualized scroll settlement;
- ordered batch mutations and one public mutation event per operation or batch;
- full initial git status followed by semantic incremental patches; and
- prepared-input reuse for navigator remounts and large resets.

Prepared-input reuse is measured with `apps/web/scripts/file-tree-prepared-input-benchmark.ts`. The
50k-path gate requires at least a 20% cached-remount speedup and no more than 15% cold slowdown.
Presorted input remains an intentional future fast path only; the app's path ordering has not been
proven comparator-compatible, so no dummy caller is maintained for it.

## API policy

Local product intent defines the public API. High-level capabilities above and the opaque
prepared/presorted input contract are retained through the single `@workspace/tree` root entry
point. Local consumers do not import package subpaths. Controller, path-store, renderer, layout,
virtualization, DOM, and state details remain implementation concerns even when Pierre exposes an
equivalent symbol.

This intentionally diverges from Pierre's wider package surface. Upstream public additions are
reviewed as behavior and do not widen the local root API without a product consumer or an explicit,
measured exception.

## Redistribution notices

`LICENSE-pierre` contains the upstream Apache-2.0 text. Surviving mapped source files carry
a modification notice. The served copy is `/licenses/pierre-tree.txt`.
