import { defineErrorCatalog } from 'evlog'

export const openCodeErrors = defineErrorCatalog('provider', {
  OPENCODE_REQUEST_FAILED: {
    status: 502,
    message: 'OpenCode could not complete the request.',
    why: 'The OpenCode HTTP server returned a failure or closed its event stream.',
    fix: 'Check the OpenCode server and start the turn again.',
  },
  OPENCODE_UNSUPPORTED: {
    status: 400,
    message: 'This OpenCode operation is unavailable.',
    why: 'The OpenCode adapter cannot execute this operation with its current transport.',
    fix: 'Use a text turn with a provider/model selection, or choose a provider supporting this operation.',
  },
  OPENCODE_SESSION_CONFLICT: {
    status: 409,
    message: 'OpenCode session is busy or belongs to another instance.',
    why: 'A native session can execute one turn at a time within its owning provider instance.',
    fix: 'Wait for the current turn or stop it, then start a turn in its owning instance.',
  },
})
