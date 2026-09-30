import {
  createEditorLanguageFeatureToken,
  registerAmbientEditorPlugin,
} from '@singapore-editor/core/extensions'

import type { EditorHoverParticipant } from './hoverParticipant'

/**
 * Named rather than imported by everyone who answers it: a language server, a character warning or
 * a diff pane has no reason to depend on each other, and restating the id is how they reach the
 * same hover.
 */
export const EDITOR_HOVER_PARTICIPANT_ID = 'editor.hoverParticipant'

export const EDITOR_HOVER_PARTICIPANT = createEditorLanguageFeatureToken<EditorHoverParticipant>(
  EDITOR_HOVER_PARTICIPANT_ID,
)

// Importing the token declares that hover content can exist. The hover itself — the surface, the
// Markdown renderer and their dependencies — loads the first time a participant registers in some
// editor, and that editor installs it for as long as it has one.
registerAmbientEditorPlugin({
  demand: EDITOR_HOVER_PARTICIPANT,
  load: () => import('./hoverPlugin').then((module) => module.createHoverPlugin()),
})
