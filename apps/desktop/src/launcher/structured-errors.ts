import { defineErrorCatalog } from 'evlog'

export const launcherErrors = defineErrorCatalog('desktop.launcher', {
  DEV_SERVER_UNREACHABLE: {
    status: 503,
    message: ({ url }: { url: string }) => `The dev server at ${url} did not answer.`,
    why: 'The desktop opens the shared dev server, which mesh starts on the first connection.',
    fix: 'Run `bun run dev:serve` once to register it. `mesh serve ls` shows why a registered route failed.',
  },
  BROWSER_SETTING_INVALID: {
    status: 400,
    message: 'The window browser setting is invalid.',
    why: 'Browser selection accepts auto, webview, or an absolute executable path.',
    fix: 'Choose auto, webview, or an absolute browser executable path in Window settings.',
  },
  CDP_FAILED: {
    status: 502,
    message: 'The browser control connection failed.',
    why: 'The browser must answer the desktop control protocol over its private pipe.',
    fix: 'Update the browser or choose another executable in Window settings.',
  },
  PWA_UNSUPPORTED: {
    status: 400,
    message: 'The browser cannot install the Fregat app.',
    why: 'The selected browser does not provide web app installation commands.',
    fix: 'Choose a browser with web app installation support or use the native window.',
  },
  PROFILE_BUSY: {
    status: 409,
    message: 'The Fregat browser profile is already open.',
    why: 'Another launcher or browser is using this profile.',
    fix: 'Let the current launch finish, or close the browser using this profile and launch Fregat again.',
  },
  VERSION_UNSUPPORTED: {
    status: 400,
    message: 'The browser engine needs an update.',
    why: 'Platform requires Chromium 126 or newer.',
    fix: 'Update the browser or choose a newer executable in Window settings.',
  },
  LAUNCH_FAILED: {
    status: 500,
    message: 'The desktop window could not open.',
    why: 'The selected browser could not create a controlled application window.',
    fix: 'Check the desktop logs and choose an installed browser in Window settings.',
  },
})
