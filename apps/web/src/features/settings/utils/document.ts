const SETTINGS_DOCUMENT_ID = 'settings:'

export function settingsDocumentId(): string {
  return SETTINGS_DOCUMENT_ID
}

export function isSettingsDocumentId(path: string): boolean {
  return path === SETTINGS_DOCUMENT_ID
}
