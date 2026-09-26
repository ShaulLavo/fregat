import { defineErrorCatalog } from 'evlog'

export const pairingErrors = defineErrorCatalog('pairing', {
  CODE_INVALID: {
    status: 400,
    message: 'That pairing code is not valid',
    why: 'A code works once and expires 5 minutes after it is made, or it was mistyped.',
    fix: 'Make a new pairing link on the paired machine and open it on this device.',
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Too many pairing attempts',
    why: 'This machine accepts 10 wrong codes a minute, so codes cannot be guessed.',
    fix: 'Wait a minute, then open the pairing link again.',
  },
  HOST_ONLY: {
    status: 403,
    message: 'Only this machine can make pairing links',
    why: 'A paired device can use this machine but cannot let further devices in.',
    fix: 'Make the link in Settings › Machines in a browser on this machine.',
  },
  DEVICE_NOT_FOUND: {
    status: 404,
    message: 'That device is not paired',
    why: 'It was removed already.',
    fix: 'Refresh the list of paired devices.',
  },
  CURRENT_DEVICE: {
    status: 409,
    message: 'A device cannot remove itself',
    why: 'Removing the device in use would lock it out mid-task.',
    fix: 'Remove it from this machine’s own browser, or from another paired device.',
  },
})
