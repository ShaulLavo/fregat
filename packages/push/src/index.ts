// Keep the MPL dependency external and defer its evaluation until push is used.
const { default: webPush } = await import('web-push')

export const generateVAPIDKeys = webPush.generateVAPIDKeys
export const generateRequestDetails = webPush.generateRequestDetails
export type { RequestDetails, Urgency } from 'web-push'
