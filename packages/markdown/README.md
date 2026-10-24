# @workspace/markdown

Streaming Markdown rendering for the web app. `createMarkdownSession` splits growing text into blocks, `healMarkdown` closes unfinished syntax so partial text renders, and `createHastProcessor` turns blocks into sanitized output. Private to this repository.

```sh
bun run --cwd packages/markdown test
```

[Document-backed content views](../../docs/document-backed-content-views.md) and the content-isolation rules in [AGENTS.md](../../AGENTS.md#content-isolation) describe where rendered Markdown may run.
