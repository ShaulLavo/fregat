import { defineErrorCatalog } from 'evlog'

export const pairingErrors = defineErrorCatalog('pairing', {
  CODE_INVALID: {
    status: 400,
    message: 'That pairing code is not valid',
    why: 'A code works once and expires 5 minutes after it is made, or it was mistyped.',
    fix: 'Make a new code in Settings › Machines › Pair a device, on the machine or a paired device.',
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Too many pairing attempts',
    why: 'This machine accepts 10 wrong codes a minute, so codes cannot be guessed.',
    fix: 'Wait a minute, then type the code again.',
  },
  PAIRED_ONLY: {
    status: 403,
    message: 'Only this machine and its paired devices can make pairing codes',
    why: 'A pairing code lets a device in, so only a device already let in can make one.',
    fix: 'Make the code in Settings › Machines on this machine or a paired device, or run `bun run pair` on this machine.',
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
  SERVER_UNREACHABLE: {
    status: 503,
    message: ({ address }: { address: string }) => `No Fregat server answered at ${address}`,
    why: 'Pairing codes come from the server running on this machine, over loopback.',
    fix: 'Start Fregat on this machine, or pass the server’s loopback origin as `--address=http://127.0.0.1:<port>`.',
  },
  SERVER_REFUSED: {
    status: 502,
    message: ({ address }: { address: string }) =>
      `The Fregat server at ${address} did not make a pairing code`,
    why: 'A server answers with a code only when the request comes from this machine.',
    fix: 'Run the command on the machine the server runs on, with the address from its `server.address` setting.',
  },
})
