# @singapore-editor/collaboration

Editor binding, session protocols, transports, and remote cursor presence for host-ordered collaboration.

Part of [Singapore](https://shaulavo.dev/singapore/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/collaboration
```

## Usage

This example validates a presence message. A room needs a document engine, authenticated links, and a clock supplied by your app.

```ts
import { Presence, parsePresence } from '@singapore-editor/collaboration'

const presence = new Presence('peer-1', 'document-1')
const message = parsePresence({ clock: 1, state: null }, 'peer-2', 'document-1')
if (message) presence.receive('peer-2', message)
console.log(presence.states)
presence.dispose()
```

## API highlights

- `createCollaborationPlugin()` attaches shared editing and selective Undo to an editor view.
- `CollaborationDocument` bridges the collab engine to session history.
- `Session` runs the transport-neutral protocol with a host-supplied document engine.
- `Presence` tracks remote selections and cursors.
- `parsePresence()` validates received presence messages.

[Generated API reference](https://shaulavo.dev/singapore/docs/reference/api/collaboration/overview/)

[Integration guide](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/collaboration/docs/integration.md)

## In the Singapore family

You can use this package on its own. `@singapore-editor/core` owns editor views; optional packages add syntax, search, gutters, and language features.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://shaulavo.dev/singapore/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
