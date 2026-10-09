import { defineErrorCatalog } from 'evlog'

export const systemErrors = defineErrorCatalog('system', {
  NOT_LOCAL: {
    status: 403,
    message: 'This server answers that only to its own machine',
    why: 'The request came through a proxy, from another address, or from a page other than this machine’s installed app.',
    fix: 'Run setup on the machine that runs this server.',
  },
  STATE_HOME_LOCKED: {
    status: 409,
    message: 'Another Fregat server already runs with this state folder',
    why: 'One server owns a state folder at a time, so two servers never write the same database.',
    fix: 'Open the running server’s address, or stop it before starting this one.',
  },
  MACHINE_ID_UNAVAILABLE: {
    status: 500,
    message: 'This machine reports no machine id',
    why: 'Fregat tells machines apart by the id the operating system keeps for this machine.',
    fix: 'On Linux, run systemd-machine-id-setup. On macOS, check that ioreg runs.',
  },
  ACTIVATION_INVALID: {
    status: 500,
    message: 'The service manager handed the server an unexpected socket',
    why: 'A socket-activated server takes exactly one listening TCP socket on the loopback address it was given.',
    fix: 'Run Fregat setup again to rewrite the service registration.',
  },
  NATIVE_PICKER_NOT_LOCAL: {
    status: 403,
    message: 'The native folder chooser opens only for this machine’s installed app',
    why: 'A chooser opened for another device would appear on a desktop its user cannot see.',
    fix: 'Choose the folder with the in-app file browser.',
  },
  NATIVE_PICKER_UNAVAILABLE: {
    status: 503,
    message: 'This machine has no native folder chooser available',
    why: 'The chooser needs the native helper and a signed-in desktop session on the server’s machine.',
    fix: 'Choose the folder with the in-app file browser.',
  },
  NATIVE_PICKER_BUSY: {
    status: 409,
    message: 'A folder chooser is already open on this machine',
    why: 'One chooser is open per desktop at a time.',
    fix: 'Finish or close the open chooser, then try again.',
  },
  NATIVE_PICKER_INVALID_OPTIONS: {
    status: 400,
    message: 'The folder chooser request is not valid',
    why: 'The chooser takes only an absolute starting folder on this machine.',
    fix: 'Reload the app and try again.',
  },
  NATIVE_PICKER_TIMEOUT: {
    status: 408,
    message: 'The folder chooser closed after its time limit',
    why: 'Nothing was chosen within the native dialog time limit.',
    fix: 'Open the chooser again, or raise the native dialog time limit in Settings › Window.',
  },
  NATIVE_PICKER_FAILED: {
    status: 500,
    message: 'The native folder chooser stopped unexpectedly',
    why: 'The chooser helper exited without reporting a choice.',
    fix: 'Try again. If it keeps failing, open the Logs panel to see the helper’s exit.',
  },
})
