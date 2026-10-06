# Document contribution source and ownership proof

Status: independently reviewed bounded proof. Performance qualification and calibrated host acceptance remain pending. This evidence does not establish complete unit acceptance or a total-memory improvement.

## Frozen products

The comparison uses clean untouched main and the contribution-runtime candidate. Both include main's word-wrap and shared-element keymap fixes.

| Identity      | Untouched main                                                     | Candidate                                                          |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Commit        | `51d2a71ae985ee930cbfaf875f87664577c2fe79`                         | `9e773c8fa7484daf63eee79f520b7cbd7967934b`                         |
| Source SHA256 | `eb9729af81865a69dd350733c674d7226c2ee28f817b3e63d474b338166d9c0c` | `e90428f88438410d9a596349425e51e8e706e196a30a59261f7407b37bb1cd0a` |
| Build SHA256  | `e9d6ea520c1da092c3b8eccf35791562ae4223167eed89ee6de3ae2668dfc61a` | `46bdf5527bda1edecee3a688e70a0daef0c426dd145a3f0503acf97fea66e98e` |

Each set contains 21 Editor packages. Both resolve external dependency SHA256 `00479327753665a28de2a23d89d4ea880ddb875f45d14bf6c9b2a5c779ad2331`. Successful runs validate actual package and dependency bytes before and after execution.

## Native minimap source volume

Both complete arms pass 605 correctness and resource checks. The observer intercepts successful native Worker posts below package diagnostics. It counts clipped summaries and full edit geometry independently, then includes both in the totals.

| Complete document and view workload                              | Main UTF16 units | Candidate UTF16 units | Main encoded UTF8 bytes | Candidate encoded UTF8 bytes |
| ---------------------------------------------------------------- | ---------------: | --------------------: | ----------------------: | ---------------------------: |
| 64 Unicode and CRLF lines, one view                              |           103418 |                103418 |                  103818 |                       103818 |
| 1M-unit long line, one view                                      |          1100122 |               1100122 |                 1100130 |                      1100130 |
| 20k short lines, two visible views and one initially hidden view |           720108 |                520073 |                  720144 |                       520099 |

Every actual summary line stays within 16 UTF16 units. The workloads include sparse Unicode edits, a 100k paste, Undo, divergent history, equal-length replacement, buffer reuse, and reveal. Native transferred canvases map to their actual DOM visibility. Current actors require exact source acknowledgement and matching rendered source receipts. The legacy protocol exposes ordered source posts and render replies without a source acknowledgement.

Reveal moves 40001 UTF16 units and 40003 encoded UTF8 bytes from earlier hidden work to the candidate's first demand. The original per-phase comparison rejects that increase and remains preserved. The separately scoped comparison permits this single mapped hidden-to-reveal shift: zero prior hidden source or render demand, latest source and pixels on reveal, and nonincreasing complete-workload totals. The complete shared workload sends 200035 fewer source units and 200045 fewer encoded bytes. No other phase increase receives an exception.

Actual source transfer-list ArrayBuffer bytes are zero on both arms. OffscreenCanvas ownership transfers occur. Graphics backing storage remains unmeasured. UTF8 source encoding is distinct from browser structured-clone serialized size.

## Tree-sitter and Shiki lifetime

The candidate completes 315 checks covering cold open, warm edit, large paste, branch Undo, equal-length buffer reuse, prepared runtime adoption, delayed replies, physical restart, multiple documents, replacement, and 40 retirements with a surviving peer.

Main completes 47 checks before its physical restart fails because the replacement Tree worker lacks TypeScript registration. Cleanup still completes. This is a failed complete baseline run. The frozen baseline is neither patched nor re-registered for the proof.

The remaining identical lifetime workload runs in a separately declared fresh-owner scope. Candidate 268 and main 266 checks pass. The two extra candidate checks inspect ordinary-reader resources. Each successful lifetime scope retires 43 buffers and 172 observed objects to zero reachability after final GC. Domain documents, source resources, pending RPCs, and native workers end at zero. The fresh-owner tail does not turn the failed restart run into a complete baseline pass.

Prepared adoption preserves actual runtime session IDs and introduces no redundant full parse, open, or source reset. The next latest edit continues on useful retained state. Known canceled work settles before the next ordered Shiki task, and the delayed reply cannot publish an obsolete source.

## LSP serialization

Both arms use the real public `LspClient`, document source adapter, controller, and connection owners with a declared external fixture socket. The socket records the actual accepted JSON string and applies source changes to its protocol mirror.

Candidate 104 and main 84 checks pass under the same proof source SHA256 `b06ac574b33398113148af188bf5c09d8f627f5658c58caa57841f985f43f53a`. Both cover incremental and full capabilities, includeText saves, no-op, scoped logical-only count 2, Unicode edits, Undo, equal-length replacement, URI rotation, reconnect, and peer retirement.

| Complete capability scope, equal in both arms | Source UTF16 units | Source encoded UTF8 bytes | RPC JSON UTF16 units | RPC JSON encoded UTF8 bytes | Accepted frames |
| --------------------------------------------- | -----------------: | ------------------------: | -------------------: | --------------------------: | --------------: |
| Incremental changes and includeText saves     |                290 |                       308 |                 6437 |                        6455 |              24 |
| Full changes and includeText saves            |                360 |                       378 |                 6289 |                        6307 |              24 |

Both arms verify exact accepted public snapshot and server source, with protocol versions. The candidate additionally verifies its exposed canonical tuple and managed-source registration. Main's public document clone does not expose those tuple fields. The original incompatible observer failure remains archived; both final arms use the same corrected capability-aware observer. No source cursor or synthetic tuple is added.

Canonical source subscriptions, protocol documents, sockets, and transport listeners retire completely. RPC bytes include JSON metadata and escaping. WebSocket framing, TLS framing, and native TypeScript worker strings are outside this socket proof.

## Memory limits

After final forced GC in the fresh-owner scope, main-renderer JS heap is 16453404 bytes on main and 16820636 bytes on the candidate. These measurements include the metadata observer. The observed candidate heap is higher.

Committed shared Tree WASM linear memory is 5701632 bytes in both arms. Complete worker heaps, Shiki WASM committed memory, allocator-live WASM, native backing stores, and graphics allocations remain unavailable. Logical source, cache, and token counts are not allocated heap bytes. This proof supports bounded ownership and payload evidence, with no total-memory gain claim.

## Evidence and remaining gates

The qualification bundle preserves original receipts, failed attempts, proof scripts, package manifests, and independently recomputed totals. Source, build, proof, measurement, and validation identities remain separate. Earlier 75 receipts retain their historical identities.

Live readiness and attestation belong to the measurement identity. Pure Node post-capture predicates belong to the validation identity. Fresh controls and qualification use the actual final instrument hash. Cached evidence is never relabeled.

The post-hook instrument from the candidate records measurement SHA256 `b615d5abd5b64684823bdbb3c727b262a31ad759eecb9f126b378f8852eeb417` and validation SHA256 `e76f680d6e087b4e71558cb8afe44ecbf96cfbfff05d5c6a5d7c79dbfb3f666e`. Its execution-dependency SHA256 is `0d9a8f1dad214e56b7013b8889086c254d96c8be28d4eab77886dad82f192aa2`. This instrument receipt declares no acceptance result.

Formal comparison replay passes for volume, the fresh-owner lifetime tail, and LSP serialization. Fresh paired latency qualification, calibrated host gates, exact-head CI, and delivery remain required. The bounded source and lifetime approval grants no waiver for those gates.
