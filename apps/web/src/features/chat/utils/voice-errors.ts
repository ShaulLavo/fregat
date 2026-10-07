import { defineErrorCatalog } from 'evlog'

export const voiceErrors = defineErrorCatalog('chat.voice', {
  CAPTURE_FAILED: {
    status: 400,
    message: 'Speech recognition stopped.',
    why: 'The browser could not capture or recognize speech.',
    fix: 'Allow microphone access and check your connection, then try dictation again.',
  },
  EMPTY: {
    status: 400,
    message: 'No speech was detected.',
    why: 'Speech recognition finished with an empty transcript.',
    fix: 'Start dictation again and speak into the microphone.',
  },
  STALE: {
    status: 409,
    message: 'The draft changed during dictation.',
    why: 'The transcript belongs to an earlier draft revision.',
    fix: 'Review the current draft and start dictation again.',
  },
})
