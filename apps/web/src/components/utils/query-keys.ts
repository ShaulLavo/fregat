export const entryPickerQueryKeys = {
  module: ['entry-picker', 'module'] as const,
  capabilities: ['entry-picker', 'server-capabilities'] as const,
  capabilityNotice: ['entry-picker', 'capability-notice'] as const,
  selection: ['entry-picker', 'native-selection'] as const,
}

export const overlayQueryKeys = {
  sessionDialogs: ['overlay', 'session-dialogs', 'module'] as const,
  themeStudioSlot: ['overlay', 'theme-studio-slot', 'module'] as const,
}
