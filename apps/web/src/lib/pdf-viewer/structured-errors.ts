import { defineErrorCatalog } from 'evlog'
import { createClientError } from '@workspace/client-core/errors'

const errors = defineErrorCatalog('pdf', {
  TEXT_UNAVAILABLE: {
    status: 422,
    message: 'PDF files open in the PDF viewer',
    why: 'PDF pages require document rendering.',
    fix: 'Open the PDF from Files to read and search its pages.',
  },
  LOAD_FAILED: {
    status: 422,
    message: 'The PDF could not be opened',
    why: 'The file could not be read or the PDF engine could not render its contents.',
    fix: 'Check that the file exists and is a valid PDF, then reopen it.',
  },
  ENGINE_UNAVAILABLE: {
    status: 503,
    message: 'The PDF viewer could not be loaded',
    why: 'The browser could not load a required PDF viewer file.',
    fix: 'Check your connection and reload the app.',
  },
})

export function pdfError(
  kind: 'LOAD_FAILED' | 'ENGINE_UNAVAILABLE' | 'TEXT_UNAVAILABLE',
  cause: unknown,
  phase: string,
) {
  const { code, status, message, why, fix } = errors[kind]
  return createClientError({
    code,
    status,
    message,
    why,
    fix,
    cause,
    internal: { phase, causeType: typeof cause },
  })
}
