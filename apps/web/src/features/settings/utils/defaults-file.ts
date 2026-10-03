import type { SettingsLayerFile } from '@workspace/contracts'
import {
  DEFAULT_SETTINGS_DOCUMENT_REVISION,
  defaultSettingsDocument,
} from '@workspace/contracts/settings/defaults-document'

/**
 * The defaults document in the shape of a layer file, so the JSON view seeds it
 * the way it seeds the user and workspace files. The defaults query retains it.
 */
export function defaultsLayerFile(): SettingsLayerFile {
  return {
    text: defaultSettingsDocument(),
    revision: DEFAULT_SETTINGS_DOCUMENT_REVISION,
    parseErrors: [],
    keyRanges: {},
  }
}
