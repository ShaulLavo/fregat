# Sealed chat evaluation batches

These three 100-message batches are selected from the published OpenAssistant/oasst1 ready
message export at the revision in `manifest.json`. The dataset is Apache-2.0; `LICENSE`
retains its license. Each message records its public dataset ID and attribution source.

The selection is frozen before candidate implementation and tuning. Source hashes are unique
across batches and disjoint from the pinned CommonMark, GFM and published chat development
sets. These are human-authored assistant messages. The selection criteria and deterministic
ordering are recorded in the manifest.

Freeze the candidate commit and artifact hashes before opening a complete batch. Record the
original denominator, all failures and evaluation receipt. A fix informed by a batch retires
that entire batch into development. Use the next sealed batch for the fixed candidate. Do not
replace individual failing messages. Generated workloads remain a separate development set.
