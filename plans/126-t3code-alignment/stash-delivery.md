# Complete composed-message stash

Pinned reference: `7445aa733ada33e45289e5aa5055f79142556513`, `ChatComposer.tsx:4390–4525`.

Stash entries carry exact prompt text, ready image/file descriptors and captured terminal selections. Transfers write the draft map and stash list in one per-environment document before publishing either view. Model and runtime choices stay with their composer. Quota failure, a changed source draft or unfinished attachment preparation leaves both messages in place. Restore swaps the current composed message into the stash; image-only and terminal-only messages are valid.

Each transferred attachment gets a fresh pending upload after its bytes are checked. This allows a rewound, session-owned attachment to move safely to another session and prevents two drafts from consuming one pending reference. Successful transfers release unused old references; failed preparation releases only newly created references. Server ownership keeps sent originals safe. Missing or expired source bytes show an error without consuming the stash entry. Stashes remain isolated by environment.

The old `platform.prompt-stash.v1` key is no longer read. This greenfield change leaves obsolete text-only development state ignored; it does not migrate or alias that format. Current draft documents retain their other drafts and model/runtime settings.

Focused tests cover one-write prompt/context transfer, swap, quota failure, pending work, environment isolation and real composer keyboard/menu behavior. `chat-stash-context` covers image-only stash, image/file payload swap, reload and native file consumption. Its live proof is pending the next deployment. Review comments, preview annotations and citations remain INTERACTION-09 work; this unit preserves the existing terminal context domain.

Live proof passed on release `20260920T153923Z-b915d3e0-plan126-stash-notices-history`: `/work/tmp/fregat-evidence/20260920T154026Z-scenario-chat-stash-context`. Both screenshots were read: image and file restored with the original prompt after reload, native file consumption succeeded, and the separate prompt returned without either attachment. Image-only stash also passed. No server warning/error logs occurred; session, provider settings and both native processes were cleaned up. A delayed TanStack preparation/restore plus navigation DOM regression verifies that completion cannot update or focus another composer, even when prompt text matches.
