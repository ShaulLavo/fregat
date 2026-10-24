import type { EditorPlugin } from '@singapore-editor/core/extensions'
import type { GapResolver, Presence } from './presence'
import { PresenceView } from './presence-view'
import './presence.css'

export type PresencePluginOptions = {
  readonly presence: Presence
  readonly resolver: GapResolver
}

/** Plain options work with a standalone Editor and with shared document views. */
export function createPresencePlugin(options: PresencePluginOptions): EditorPlugin {
  return {
    name: 'editor.collaboration.presence',
    activate(plugin) {
      return plugin.registerViewContribution({
        createContribution: (view) => new PresenceView(view, options),
      })
    },
  }
}
