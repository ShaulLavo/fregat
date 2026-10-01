import { defineErrorCatalog } from 'evlog'

export const acpErrors = defineErrorCatalog('provider-acp', {
  CLOSED: {
    status: 503,
    message: 'The agent connection closed.',
    why: 'The provider process ended before it answered.',
    fix: 'Send the message again to reconnect the agent.',
  },
  PROTOCOL: {
    status: 502,
    message: 'The agent sent an unreadable response.',
    why: 'The provider response does not match the ACP protocol.',
    fix: 'Check the provider executable and update its CLI.',
  },
  REQUEST_FAILED: {
    status: 502,
    message: 'The agent could not complete the request.',
    why: 'The provider returned an ACP error.',
    fix: 'Check the provider account and retry the request.',
  },
  ABORTED: {
    status: 409,
    message: 'The agent request was cancelled.',
    why: 'The request ended before the provider answered.',
    fix: 'Send another message when you are ready.',
  },
  RESUME_UNSUPPORTED: {
    status: 409,
    message: 'This agent cannot resume the conversation.',
    why: 'The provider does not advertise the required ACP session operation.',
    fix: 'Start a new conversation or update the provider CLI.',
  },
  BUSY: {
    status: 409,
    message: 'This agent is already answering.',
    why: 'One ACP session accepts one active prompt.',
    fix: 'Wait for the answer or stop the turn.',
  },
})
