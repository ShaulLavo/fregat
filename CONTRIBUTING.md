# Contributing to Fregat

Fregat develops the app, Singapore, ghostty-webgpu, and hotkeys in this repository.
The standalone package repositories are read-only mirrors. Send changes here.

## Choose where to start

- Ask usage and design questions in [Discussions](https://github.com/ShaulLavo/fregat/discussions).
- For a bug, search [existing issues](https://github.com/ShaulLavo/fregat/issues) first. Include the product, version or commit, reproduction steps, expected result, and actual result.
- For a feature, explain the problem and a concrete example of who needs it. Link related discussions or issues.
- Report vulnerabilities through [private security advisories](SECURITY.md).

The [roadmap](PLAN.md) records approved work. Discuss a large change before implementing it so we can agree on scope.
If you take an open issue, check for an `in progress` label or claim comment first. Claim available work with a comment naming your branch or PR.

## Set up a checkout

Install [Bun](https://bun.sh/) and [Git](https://git-scm.com/), then run:

```sh
git clone https://github.com/ShaulLavo/fregat.git
cd fregat
bun install --frozen-lockfile
bun run dev
```

Read [docs/development.md](docs/development.md) for the package layout, source builds, and platform prerequisites.
Read [AGENTS.md](AGENTS.md) for repository conventions. Singapore changes also follow [editor/AGENTS.md](editor/AGENTS.md); terminal changes follow [ghostty-webgpu/AGENTS.md](ghostty-webgpu/AGENTS.md).

## Make and verify a change

1. Create a branch with one focused change. Preserve other work in the checkout.
2. For a bug fix, reproduce the failure first and add a regression test that catches it.
3. Run the narrowest relevant checks. `bun run verify` runs the repository checks. Workspace consumers need `bun run build:workspaces` before typechecking built library exports.
4. For UI changes, inspect the result in a browser and include screenshots. For performance changes, retain the method and before-and-after measurements.
5. Open a PR that explains the user's problem, the change, and the commands you ran. Name skipped checks and known limits.

Tests must run from a fresh checkout. Use temporary fixtures and mock external providers.
Keep credentials, private paths, and personal data out of fixtures, screenshots, logs, and reports.

Docs-only changes need no changeset. Package code changes follow the repository's patch-release policy and Changesets workflow.

## AI contributions

AI-assisted contributions are welcome. You own the submitted change and must read, understand, and verify every part of it.
Describe material AI assistance in the PR and state the checks you ran yourself.
Use actual test output and measurements as evidence. Review generated claims, links, and dependency licenses.
Keep PRs focused. Send a change only when you can explain its behavior and maintain it.

## License

By contributing, you agree to license your contribution under this project's [MIT license](LICENSE).
Keep third-party copyright and license notices with code you reuse.
