# Plan 163: A screenshot from the composer

## Status and authorization

- Status: PROPOSED — ready; D1 accepted as recommended on 2026-09-25. The owner approved the item on 2026-09-25.
- Priority: P3. Small and self-contained.
- Effort: S. One capture function, one menu, one mutation key.
- Risk: LOW. It is additive: a cancelled or unsupported capture does nothing.
- Planned at: Platform `9c1c45d1`, 2026-09-25. Research:
  [ai-elements.md](../docs/ui-research/ai-elements.md) item 7.
- The owner's other request from the same pass, exporting a chat as Markdown from the session
  menu and a context menu, is not here. [Plan 145's export plan](145-harness-controls/export.md)
  already owns it and now carries the context-menu requirement.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Deploy with `bun run deploy` (web only).

## Outcome

From the composer, the user can take a screenshot of a screen, window or tab and have it staged
as an image attachment, exactly as if they had pasted it. Cancelling the browser's picker leaves
the composer as it was, with no toast and no error.

## What exists today

- The composer has one attach control: `features/chat/components/chat-input-attach-button.tsx`, a
  ghost icon button (paperclip) that clicks a hidden `<input type="file">`. It is a button, not a
  menu. It is rendered by `chat-input-actions.tsx:110` for the composer and by
  `pending-user-input-card.tsx:201` for an agent's question.
- Picked, pasted and dropped files all go through one pipeline: `onSelectImageFiles` →
  `handleImageFiles` in `chat-input.tsx:305` → `useAttachmentPreparation(draftTarget)`, a mutation
  keyed `chatMutationKeys.attachments`. A screenshot only needs to arrive there as a `File`.
- The reference is AI Elements' `PromptInputActionAddScreenshot`
  (`references/ai-elements/packages/elements/src/prompt-input.tsx:100-170`, with tests in
  `__tests__/prompt-input.test.tsx:170-240`). It works in six steps:
  1. `getDisplayMedia({ video: true, audio: false })`
  2. play the stream in a muted, detached `<video>`
  3. wait for `loadedmetadata`
  4. draw one frame to a canvas
  5. `toBlob('image/png')`
  6. wrap the blob as `screenshot-<timestamp>.png`, stop every track in `finally`, and return
     `null` on cancel or when the API is missing

  AI Elements is Apache-2.0. The function is about 40 lines of standard browser calls, so we
  write our own rather than copy it, and no notice is needed.

## Design

- **Capture.** A mutation, per the async-effects rule: local async work still goes through
  TanStack. It lives in a new `hooks/use-screenshot-capture.ts` with
  `chatMutationKeys.screenshot(environmentId, draftKey)` in `utils/mutation-keys.ts`. The
  `mutationFn` captures one frame and resolves to `File | null`. `onSuccess` hands a non-null file
  to the same `onSelectImageFiles` the paperclip uses, so size limits and classification stay in
  one place. The in-flight state is `useIsMutating` on that key, which shows an `OrbitLoader` in
  the menu item's icon slot, never a local boolean.
- **Cancel is not an error.** The user dismissing the picker rejects with `NotAllowedError`, which
  resolves to `null`, not a failure. A real failure, such as a missing API or a frame that never
  arrives, is a `createStructuredError` catalog entry. Its `fix` tells the user what to do: "Your
  browser did not allow screen capture. Attach the image as a file instead."
- **Visibility.** The item is hidden when `navigator.mediaDevices?.getDisplayMedia` is missing.
  That covers phones and some embedded webviews.
- **The picker appears every time.** Browsers do not let a page remember a screen choice, so each
  screenshot shows the OS/browser share dialog. That is expected; the plan does not try to cache a
  stream, which would keep the screen-share indicator lit.
- **Desktop shell.** Electrobun's webview may not implement `getDisplayMedia`, or may need an
  entitlement. On macOS it needs the Screen Recording permission. Phase 1 checks this in the
  desktop build (`apps/desktop`, `isDesktop()` in `lib/platform/bridge.ts`). If it is unsupported
  there, the item is hidden on desktop, like on phones. A native capture through the bridge is a
  follow-up, not part of this plan.
- **Stop the stream every time.** Stop every track in `finally`, including on the error path, so
  the browser's "sharing your screen" indicator never outlives the capture.

## Decisions

Decided 2026-09-25: the owner accepted every recommendation below ("whatever seems best"). The
alternatives stay only as a record of what was weighed.

- **D1 — where the item lives.** The paperclip is a single button today. Recommended: it becomes a
  menu with two items, "Attach files…" and "Screenshot…". It stays one icon in the composer bar
  and has room for later sources (a workspace file, clipboard history). Alternative: a second icon
  button beside the paperclip, which keeps file attach one click but grows the composer bar. The
  question card (`pending-user-input-card.tsx`) takes the same control either way.

## Steps

1. Check `getDisplayMedia` in the Electrobun build on Linux and macOS, and record the result here.
2. The mutation key, `use-screenshot-capture.ts`, and the capture function with its cancel,
   failure and `finally` paths. Add the catalog entry.
3. The menu or button per D1, in `chat-input-attach-button.tsx`. The item carries its tooltip and
   `aria-label` like the paperclip, and its icon is Phosphor `CameraIcon` at `size-(--icon-size-sm)`.
4. Wire both call sites.

## Verification

- A `dom` test with `getDisplayMedia` stubbed at the browser boundary, as AI Elements' test does:
  - a frame becomes one staged PNG through `onSelectImageFiles`
  - `NotAllowedError` stages nothing and raises no toast
  - the stream's tracks are stopped on success, cancel and failure
  - with no API, the item is hidden
- `agent:browser look` on the composer with the menu open, both densities. The real capture cannot
  be scripted past the OS picker, so a scenario launches Chromium with
  `--use-fake-ui-for-media-stream --auto-select-desktop-capture-source` to capture the fake source,
  and asserts one staged attachment.
- The owner takes one real screenshot on the mesh build and on the desktop build.
- `bun run gates`.
