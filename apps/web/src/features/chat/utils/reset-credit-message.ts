import type { ProviderResetCreditResult } from '@workspace/contracts'

export function resetCreditMessage(result: ProviderResetCreditResult) {
  if (result.refresh === 'unconfirmed')
    return 'The reset outcome is recorded. Current usage limits could not be confirmed.'
  switch (result.outcome) {
    case 'reset':
      return 'Usage limits reset.'
    case 'alreadyRedeemed':
      return 'The previous reset was confirmed.'
    case 'nothingToReset':
      return 'No usage window needs a reset.'
    case 'noCredit':
      return 'No reset credits are available.'
  }
}
