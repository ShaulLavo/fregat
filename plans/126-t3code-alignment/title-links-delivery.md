# Bounded linked title context

Title generation now resolves supported source-control links before calling the provider. The reactor supplies the session's owning worktree directory. The scanner follows pinned `ThreadTitleLinks.ts` at `7445aa733ada33e45289e5aa5055f79142556513`: HTTPS only, trailing punctuation removal, query/hash removal, deduplication, and a budget of two supported links. Unsupported links do not spend that budget.

GitHub and GitLab cloud-host patterns match the pinned source-control provider resolvers. Lookups use the actual `gh api` and `glab api` commands, pinned host arguments, and explicit issue/change-request endpoints; they never infer a linked subject from the checkout's current branch. Unsupported hosts or credential-bearing URLs are not passed to those CLIs. Missing tools, authentication failures, malformed responses, output limits and timeouts produce an explicit `<url>: unavailable` context entry.

Both selected lookups run concurrently. Each uses the existing bounded process runner with a three-second deadline and 32,000-byte output limit. Included title/body lengths are capped at 300/1,200 characters. The prompt identifies results as reference data rather than instructions and tells the model not to repeat lookups or substitute local Git history.

Sixteen focused link/lifecycle tests pass. These include 14 URL cases executed against the actual pinned provider resolver bodies and seven messages executed against the actual pinned scanner loop. Negative cases cover unsupported hosts, credentials, ports, invalid issue numbers, duplicate links, budget theft by unsupported links, timeout/error/malformed results, and reversed lookup completion order. Server typecheck and changed-file lint pass.

These are local policy, injected process-boundary and existing reactor tests. They do not prove authenticated external GitHub/GitLab lookup in the live deployment. The new source is pending the next shared release. Custom title-policy settings and the full provider/source-control matrix remain outside this unit.

Live check (2026-09-25, completion wave): `resolveSessionTitleLinks` run through the real,
authenticated `gh` returned the title and body of `https://github.com/ShaulLavo/fregat/pull/38`.
