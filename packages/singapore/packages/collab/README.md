# @singapore-editor/collab

Host-ordered text editing with persistent snapshots and character identities for collaboration engines.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

Not on npm yet. Build it from source with the [development guide](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/docs/development.md#set-up).

## Usage

This example creates a local edit. Your host must order edits and deliver its messages to participants.

```ts
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { Participant, TextbufferEngine } from '@singapore-editor/collab'

const buffer = createPieceTableSnapshot('hello', {
  normalized: true,
  charIds: { bunch: 'shared-document:0', counter: 0 },
})
const engine = new TextbufferEngine(buffer)
const participant = new Participant({
  actor: crypto.randomUUID(),
  document: 'document',
  epoch: '1',
  engine,
})
const edit = participant.local({ offset: 5, deleteCount: 0, text: ' world' })
// Submit edit to the Host; deliver its ordered HostMessages to participant.receive.
```

## No end-to-end quick start yet

There is no runnable example with a host and two participants. The example above makes one local edit and stops there. The [integration guide](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/packages/collab/docs/integration.md) describes the host's job, and the `collaboration` package adds the editor binding and transports that a working setup needs.

## API highlights

- `Participant.local()` creates an optimistic local edit.
- `Participant.receive()` applies ordered host messages.
- `TextbufferEngine` stores text in persistent snapshots.
- `ConfirmedWindow` finds concurrent edits by different authors and their character ID spans.
- `Engine.projectEffects()` creates local author/base review snapshots while preserving live state.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/collab/overview/)

[Integration guide](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/packages/collab/docs/integration.md)

## In the Singapore family

You can use this package on its own. `@singapore-editor/core` owns editor views; optional packages add syntax, search, gutters, and language features.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/LICENSE)
