# Packages as products: research

Research for [Plan 336](../../../plans/336-packages-as-products.md). One file per topic, written by
research agents on 2026-10-08. The synthesis section below is filled in once every file lands.

## Files

| File                       | Topic                                                                  |
| -------------------------- | ---------------------------------------------------------------------- |
| fregat-workbench.md        | What's impressive in the Fregat web app, from code, plans and history  |
| fregat-platform.md         | Server, clients, agents, local-first and remote: what's impressive     |
| performance-evidence.md    | Every measured performance number we have, and the gaps                |
| singapore.md               | What's impressive in the Singapore editor, shipped and planned         |
| ghostty-webgpu.md          | What's impressive in ghostty-webgpu, shipped and planned               |
| other-packages.md          | hotkeys, tree-sitter-x, tree-sitter-md and unpublished shared packages |
| roadmap-highlights.md      | Planned work worth announcing, per project                             |
| readme-exemplars.md        | How the best repositories present themselves                           |
| landing-sites.md           | How the best product sites sell                                        |
| docs-exemplars.md          | How the best documentation is built                                    |
| release-cycles.md          | How the best projects release, version and write changelogs            |
| competitive-positioning.md | What competitors claim, and where we win                               |

## Synthesis

[Plan 336](../../../plans/336-packages-as-products.md) carries the decisions; this is the short
version.

1. **Ship before selling.** npm serves 0.1.2 (2026-09-28) while the repo is at 0.2.6 and 0.3.20,
   because the publish job's `NPM_TRUSTED_PUBLISHING` gate was never set; `@fregat/hotkeys` was never
   published. fregat and Singapore have no license. Both block any launch copy
   ([release-cycles](release-cycles.md), [readme-exemplars](readme-exemplars.md)).
2. **Our claims outran our proof.** ghostty-webgpu wins parsing (2.6–5.2×), streaming energy and idle
   CPU, but loses some like-for-like renderer cases; the memory headline omits wasm. Fregat and
   Singapore have no competitor measurements. Four bounded benchmarks close the gaps
   ([performance-evidence](performance-evidence.md)).
3. **Lead with what only we have.** Open source, local, bring-your-own-agents and phone access are
   table stakes; "an open Cursor" and "a modern Monaco" are taken. Fregat's open space is a complete,
   fast browser IDE built from our own parts, where work keeps going and agent output is reviewed like
   a pull request ([competitive-positioning](competitive-positioning.md),
   [fregat-workbench](fregat-workbench.md), [fregat-platform](fregat-platform.md)). Singapore sells its
   architecture: versioned documents, surviving anchors, work in workers, modern platform APIs
   ([singapore](singapore.md)). ghostty-webgpu sells Ghostty's core plus published, reproducible
   benchmarks ([ghostty-webgpu](ghostty-webgpu.md)). hotkeys has no rival on npm
   ([other-packages](other-packages.md)).
4. **We undersell shipped work.** File-tree undo, an undo graph that survives closing a file,
   terminals that survive server restarts, per-hunk agent undo, fan-out to worktrees, a 155 ms → 0.004 ms
   token-update win, server-rendered first terminal frames ([roadmap-highlights](roadmap-highlights.md)).
5. **Planned work shows as a status table**, announced only when started
   ([roadmap-highlights](roadmap-highlights.md)).
6. **How the best do it:** a 15-word pitch reused everywhere, proof on the first screen, the product
   live in the page, every number with a reproduce link, short READMEs that hand teaching to docs
   ([readme-exemplars](readme-exemplars.md), [landing-sites](landing-sites.md)); Diátaxis docs with
   type-checked samples and generated reference ([docs-exemplars](docs-exemplars.md)); `latest` plus
   `next` channels, PR previews and user-facing changelogs ([release-cycles](release-cycles.md)).
