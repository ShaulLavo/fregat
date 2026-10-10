# Plan 313: keep quiet jobs and dev servers making progress

Status: transferred to the owner's private heavy-runner repository on 2026-10-10.

The runner, Pi lane, tests, installer and execution-host scheduling work now belong to
[heavy-runner](https://github.com/ShaulLavo/heavy-runner). Continue this plan in
[the extracted repository](https://github.com/ShaulLavo/heavy-runner/blob/main/plans/313-heavy-quiet-lifecycle.md).
The local `fregat-local` skill documents the installed tool and its update command.
Fregat contributor commands and CI run without it.

[Earlier implementation and verification records](https://github.com/ShaulLavo/fregat/blob/c4899de316214a90df6668105e8caa2e92cd679d/plans/313-heavy-quiet-lifecycle.md) remain in Fregat history. The extraction includes the Pi cleanup deadline fix from #1213 and leaves the installed runner untouched.
