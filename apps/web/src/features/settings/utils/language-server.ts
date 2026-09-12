import { SETTINGS_JSON_SCHEMA } from '@workspace/contracts'

import type { LanguageServerDocumentTarget } from '@/features/editor/utils/language-server-plugin'
import { documentKey } from '@/lib/documents/utils/identity'
import { settingsTab, tabDocuments } from '@/lib/documents/utils/tabs'

const SETTINGS_SCHEMA_ASSOCIATION = {
  uri: 'platform://schemas/settings',
  fileMatch: tabDocuments(settingsTab()).map(documentKey),
  schema: SETTINGS_JSON_SCHEMA,
} as const

export const SETTINGS_LANGUAGE_SERVER_TARGET = {
  matchPath: '.platform/settings.json',
  disabledFeatures: ['diagnostics'],
  sharedNotificationsByServer: {
    'json-ls': [
      {
        method: 'json/schemaAssociations',
        // Raw JSON-RPC arrays are positional, so the single array argument needs one wrapper.
        params: [[SETTINGS_SCHEMA_ASSOCIATION]],
      },
    ],
  },
} as const satisfies LanguageServerDocumentTarget
