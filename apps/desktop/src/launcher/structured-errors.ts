import { defineErrorCatalog } from 'evlog'

export const launcherErrors = defineErrorCatalog('desktop.launcher', {
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
