import { expect, test } from '../../../test/fixtures'
import { requireContext } from '@/lib/require-context'
import { clientErrors } from '@/lib/structured-errors'

test.each([{ ready: true }, false, 0])('a provided context value (%s) passes', (value) => {
  expect(() => requireContext(value, 'unused')).not.toThrow()
})

test.each([null, undefined])(
  'a missing provider (%s) throws CONTEXT_MISSING with its message',
  (value) => {
    const message = 'useThing must be used within ThingProvider'

    expect(() => requireContext(value, message)).toThrowError(
      expect.objectContaining({
        code: clientErrors.CONTEXT_MISSING.code,
        fix: clientErrors.CONTEXT_MISSING.fix,
        message,
      }),
    )
  },
)
