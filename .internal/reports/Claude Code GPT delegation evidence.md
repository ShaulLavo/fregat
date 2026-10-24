# Native Sol delegation evidence

Verified on 2026-09-29 using the installed `claude-gpt` launcher and a single ad hoc live-agent check.

The Claude Code initialization event named parent model `claude-opus-5-5` and included the `sol` agent. The parent invoked the canonical `Agent` tool with `subagent_type: sol` and `run_in_background: false`. Child assistant events named model `gpt-6.1-sol` and referenced the same parent Agent tool-use ID.

The child invoked `Bash` with `pwd`. The tool succeeded and returned `/home/shaul/Projects/platform`. The child returned `SOL_NATIVE_OK` and that working directory through the normal Agent handback, identifying agent `a35c667c34cee26db`. The parent then completed successfully.

This proves actual Sol model delegation and a tool operation within Claude Code's Agent workflow. No screenshot of the interactive terminal interface was captured or inspected.

Claude Code emitted an `unrecognized_model` warning for `gpt-6.1-sol`; execution nevertheless succeeded. Its displayed provider/cost metadata described GPT as `firstParty` with unknown cost basis. That display is not evidence of an Anthropic invoice or accurate cross-provider billing attribution.

The raw session-scoped transcript was captured at `.scratch/claude-gpt/native-check.jsonl`. This summary preserves the relevant evidence without publishing full conversation or environment contents.

Both accounts completed independent OpenAI device authentication. The proxy auth directory contains exactly two credentials with different account IDs and permissions `0600`. CLIProxyAPI owns their refresh lifecycle, with no dependency on `~/.codex/auth.json`. Remote login uses the `-no-browser` device flow.

An isolated, access-only second-account Sol request returned `429 usage_limit_reached`. No refresh token was shared with that verification process. Forced failover and quota-reset recovery were not tested. After the final service restart, authenticated model discovery succeeded locally and through mesh, with `gpt-6.1-sol` available. Unauthenticated model discovery returned `401`, and the disabled management endpoint returned `404`.
