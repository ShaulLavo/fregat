import { defineErrorCatalog } from 'evlog'

export const serviceErrors = defineErrorCatalog('service', {
  ADDRESS_HELD_BY_OTHER_PROGRAM: {
    status: 409,
    message: 'Another program listens on the Fregat server address',
    why: 'Fregat installs at a fixed address so the installed app keeps one identity, and a different program already answers there.',
    fix: 'Stop that program, or set another loopback port in Settings › Machines › Server address, then run setup again.',
  },
  ADDRESS_HELD_BY_OTHER_FREGAT: {
    status: 409,
    message: 'A Fregat server with different state already runs at this address',
    why: 'The server at this address keeps another state folder or environment, and one address serves one state folder.',
    fix: 'Choose that server as the one to use, or set another loopback port for this state folder, then run setup again.',
  },
  IDENTITY_UNVERIFIED: {
    status: 502,
    message: 'The server at this address did not prove which state folder it serves',
    why: 'Setup reuses a listener only after it answers with the identity key from this state folder, and it did not within the start time limit.',
    fix: 'Check the Fregat server logs for a failed start, or raise Settings › Machines › Server start time limit, then run setup again.',
  },
  REGISTRATION_FAILED: {
    status: 500,
    message: 'The Fregat server could not be registered with the service manager',
    why: 'Setup writes a launchd agent or systemd user socket and service, and that step did not complete.',
    fix: 'Check that a release exists in the server release folder, and remove a Fregat registration left by another installation with the server uninstall, then run setup again.',
  },
  REGISTRATION_NOT_OURS: {
    status: 409,
    message: 'A Fregat server registration this setup did not write is in place',
    why: 'Uninstall removes only a registration whose files setup wrote and whose running server proves this state folder.',
    fix: 'Check the named file and remove that registration with the tool that installed it.',
  },
  UNSUPPORTED_PLATFORM: {
    status: 501,
    message: 'Fregat installs its server service on macOS and Linux',
    why: 'The server runs under launchd on macOS and a systemd user socket on Linux.',
    fix: 'Run the server by hand on this platform.',
  },
  SETUP_BUSY: {
    status: 409,
    message: 'Another Fregat setup is installing this server',
    why: 'Setup for one state folder runs one at a time so two installers never overwrite each other.',
    fix: 'Wait for the other setup to finish, then run setup again.',
  },
})
