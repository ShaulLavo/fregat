import { defineErrorCatalog } from 'evlog'

export const fontErrors = defineErrorCatalog('fonts', {
  UNAVAILABLE: {
    status: 503,
    message: 'The font is temporarily unavailable.',
    why: 'The font download or cached font could not be read.',
    fix: 'Check the network connection and retry. The bundled font remains available.',
  },
})
