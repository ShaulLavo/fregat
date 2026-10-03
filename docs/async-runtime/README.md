# Async runtime research

Research date: 2026-10-03. This is upfront research and design for [Plan 328](../../plans/328-async-runtime-master.md). Implementation is deferred. No prototype, new package, runtime dependency choice or performance measurement is claimed by this record.

## Read first

- [Worker and message-runtime inventory](inventory.md): source owners, scheduling, dependency/service workers and terminal work in flight.
- [Architecture decision](architecture.md): modular services versus a scoped actor registry, usage/contracts, selected base and required invariants.
- [Independent review](design-review.md): scores, grafts and proof obligations incorporated into the plans.
- [Measurement grounding](measurements.md): existing Editor/terminal evidence and instrument limits. [Plan 334](../../plans/334-async-runtime-verification.md) owns future stages/order/checklists.

## Library lanes

| Library             | Inspected source                           | Release distinction                                                                 | Report                              |
| ------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------- |
| Comlink             | `114a4a6448a855a613f1cb9a7c89290606c003cf` | Latest release inspected: 4.4.2; main includes unreleased release-handshake changes | [Comlink](comlink.md)               |
| W4G1/multithreading | `a42ce15cf8fb3c61d2b190222cf5b9a49fc34442` | npm 0.3.52 registry gitHead matches source; tarball inspected                       | [Multithreading](multithreading.md) |
| Coaction            | `22cf104e4353932b747d40022d1c8570e13d3137` | Main is newer than published 4.0.0; released behavior needs separate qualification  | [Coaction](coaction.md)             |

The [original modular candidate](design-a.md) and [actor-registry candidate](design-b.md) retain alternatives for review. They are research sketches; architecture.md and Plans 328–334 supersede conflicting draft details, including moved-input ownership and pilot repetition counts. Type sketches are design contracts, not compiled package APIs.

Fregat source inspection used `6d8e768703c1bfc92091dbdd41c9171d5942f263`; GitHub main moved to `81b09d4b0dff5f5f39a54df0320a9bdf770572df` during research. The inventory distinguishes local, upstream, PR and live release identities. Refresh implementation inputs before using this dated evidence.
