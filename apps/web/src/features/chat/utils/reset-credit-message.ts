import type { ProviderResetCreditResult } from '@workspace/contracts'

export function resetCreditMessage(result: ProviderResetCreditResult) {
  if (result.refresh === 'unconfirmed')
    return 'The reset went through, but your current usage limits could not be loaded.'
  switch (result.outcome) {
    case 'reset':
      return 'Usage limits reset.'
    case 'alreadyRedeemed':
      return 'Your last reset already went through.'
    case 'nothingToReset':
      return 'Your usage limits are not used up, so nothing was reset.'
    case 'noCredit':
      return 'No reset credits are available.'
  }
}
