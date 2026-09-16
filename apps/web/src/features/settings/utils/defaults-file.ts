import {
  DEFAULT_SETTINGS_DOCUMENT_REVISION,
  defaultSettingsDocument,
  type SettingsLayerFile,
} from '@workspace/contracts'

let cached: SettingsLayerFile | null = null

/**
 * The defaults document in the shape of a layer file, so the JSON view seeds it
 * the way it seeds the user and workspace files. Rendered once: the registry is
 * code and cannot change while the page is open.
 */
export function defaultsLayerFile(): SettingsLayerFile {
  cached ??= {
    text: defaultSettingsDocument(),
    revision: DEFAULT_SETTINGS_DOCUMENT_REVISION,
    parseErrors: [],
    keyRanges: {},
  }

  return cached
}
