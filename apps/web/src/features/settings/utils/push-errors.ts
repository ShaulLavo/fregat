import { defineErrorCatalog } from 'evlog'

/** What this browser can and cannot do about push. The server's half is `apps/server/src/push`. */
export const pushErrors = defineErrorCatalog('push', {
  PERMISSION_DENIED: {
    status: 403,
    message: 'Notifications are blocked for this site',
    why: 'The browser denied notification permission, and a page cannot ask again once it is denied.',
    fix: 'Allow notifications for this site in the browser’s site settings, then turn push notifications on again.',
  },
  PERMISSION_DISMISSED: {
    status: 403,
    message: 'The notification prompt closed without an answer',
    why: 'Push notifications need notification permission for this site.',
    fix: 'Turn push notifications on again and choose Allow.',
  },
  UNSUPPORTED: {
    status: 501,
    message: 'This browser cannot receive push notifications',
    why: 'It lacks service workers or the Push API, or the page is served over plain http.',
    fix: 'Open the app over https in a current Chrome, Edge, Firefox or Safari.',
  },
  NOT_INSTALLED: {
    status: 409,
    message: 'On iPhone and iPad, push needs the app on the Home Screen',
    why: 'iOS delivers Web Push only to a web app added to the Home Screen.',
    fix: 'Tap Share, choose Add to Home Screen, open the app from there, and turn push notifications on.',
  },
  SCOPE_TAKEN: {
    status: 409,
    message: 'Another service worker controls this page',
    why: 'Push needs its own service worker at the app’s address, and this page already runs a different one, as the demo does.',
    fix: 'Open the app from its server to use push notifications.',
  },
  SUBSCRIBE_FAILED: {
    status: 502,
    message: 'The browser could not subscribe to its push service',
    why: 'The browser’s push service refused or could not be reached. Builds without one, such as embedded and headless browsers, fail here.',
    fix: 'Try again in a regular browser window. If it keeps failing, check that the browser can reach the internet.',
  },
})
