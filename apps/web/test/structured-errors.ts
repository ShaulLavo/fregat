import { createStructuredError } from '@workspace/observability/errors'
import { defineErrorCatalog } from 'evlog'

const fixtureErrors = defineErrorCatalog('test-fixture', {
  BINARY_BODY_UNSUPPORTED: {
    status: 500,
    message: 'Binary bodies need the node test project.',
    why: 'Happy DOM stringified the native Blob or File returned by the real server route.',
    fix: 'Move the binary response assertion to a .test.ts file in the node test project.',
  },
})

export function binaryBodyUnsupportedError(response: Response) {
  return createStructuredError({
    code: fixtureErrors.BINARY_BODY_UNSUPPORTED.code,
    status: fixtureErrors.BINARY_BODY_UNSUPPORTED.status,
    message: fixtureErrors.BINARY_BODY_UNSUPPORTED.message,
    why: fixtureErrors.BINARY_BODY_UNSUPPORTED.why,
    fix: fixtureErrors.BINARY_BODY_UNSUPPORTED.fix,
    internal: {
      environment: 'happy-dom',
      responseStatus: response.status,
      declaredByteLength: response.headers.get('content-length'),
      serializedByteLength: 13,
    },
  })
}
