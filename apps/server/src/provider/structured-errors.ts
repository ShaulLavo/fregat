import { errorStringField } from '@workspace/contracts'
import { defineErrorCatalog } from 'evlog'

export const sessionIdentityErrors = defineErrorCatalog('provider', {
  UPDATE_MANUAL_ONLY: {
    status: 409,
    message: 'This CLI updates from outside the app.',
    why: 'Its install belongs to a version manager, Homebrew or the app itself, or its origin is unknown.',
    fix: 'Run the command shown beside the version, or reinstall the CLI with npm or its own installer.',
  },
  ROLLBACK_UNSUPPORTED: {
    status: 409,
    message: 'This provider cannot rewind its conversation.',
    why: 'The selected adapter does not support native conversation rollback.',
    fix: 'Continue this conversation or start a new session. No files were restored.',
  },
  ROLLBACK_RUNTIME_UNAVAILABLE: {
    status: 409,
    message: 'The provider runtime is unavailable for rewind.',
    why: 'Rewind requires an active binding to the same native conversation.',
    fix: 'Resume the provider session before rewinding. No files were restored.',
  },
  SESSION_NOT_RUNNING: {
    status: 409,
    message: 'The session is not running.',
    why: 'This control talks to the live provider process, and the session has none.',
    fix: 'Send a message to start the session, then try again.',
  },
  SESSION_CONTROL_UNSUPPORTED: {
    status: 409,
    message: "This session's provider does not offer that control.",
    why: 'The session runs on a provider without it, or has no provider binding yet.',
    fix: 'Use the provider’s own settings or command line for this.',
  },
  TASK_STOP_UNSUPPORTED: {
    status: 409,
    message: "This provider's background tasks cannot be stopped from here.",
    why: 'The session runs on a provider with no stop-task control.',
    fix: 'Stop the whole agent session instead.',
  },
  STEERING_UNAVAILABLE: {
    status: 409,
    message: 'This provider cannot accept a correction while running.',
    why: 'No active provider session supports native turn steering.',
    fix: 'Stop the turn or wait for it to finish, then send the message.',
  },
  TERMINAL_OWNERSHIP_UNKNOWN: {
    status: 409,
    message: 'The previous terminal process may still own this session',
    why: 'The server restarted before the agent CLI exit was confirmed.',
    fix: 'Inspect and stop the previous agent CLI. Keep this session closed until its process ownership is resolved.',
  },
  SESSION_IN_TERMINAL: {
    status: 409,
    message: 'This session is open in a terminal',
    why: 'The terminal CLI exclusively owns this conversation until its process exits.',
    fix: 'Exit the agent CLI before sending another chat prompt.',
  },
  TERMINAL_HISTORY_PENDING: {
    status: 409,
    message: 'Terminal history still needs to synchronize',
    why: 'The CLI exited, but its conversation has not been saved into the chat projection.',
    fix: 'Reconnect the session terminal to retry synchronization before sending another prompt.',
  },
  TERMINAL_UNSUPPORTED: {
    status: 400,
    message: 'Terminal resume requires an enabled Claude provider',
    why: 'This provider instance cannot resume a canonical Claude conversation in its CLI.',
    fix: 'Choose a Claude session or use the chat view.',
  },
  TERMINAL_SESSION_INVALID: {
    status: 409,
    message: 'The session cannot open in this terminal',
    why: 'The session was deleted, belongs to another checkout, or has work in progress.',
    fix: 'Wait for the active turn to finish and reopen the session in its own checkout.',
  },
  MCP_SERVER_NOT_AWAITING_APPROVAL: {
    status: 409,
    message: 'That MCP server is not waiting for approval.',
    why: "Only a server from the checkout's .mcp.json that this session turned off can be approved.",
    fix: 'Reopen the MCP list; the server may already be approved.',
  },
  APPROVAL_DECISION_NOT_OFFERED: {
    status: 409,
    message: 'This approval does not offer that choice',
    why: 'The agent listed the answers it accepts for this request, and the chosen one is not among them.',
    fix: 'Pick one of the choices shown on the approval.',
  },
  SERVICE_CLOSED: {
    status: 503,
    message: 'The provider service is shutting down',
    why: 'A runtime cannot acquire ownership after provider shutdown begins.',
    fix: 'Reconnect after the server restarts.',
  },
  OPERATION_TIMED_OUT: {
    status: 504,
    message: 'The provider operation timed out',
    why: 'The adapter did not finish within its operation timeout.',
    fix: 'Retry cleanup after inspecting the provider process.',
  },
  SESSION_IDENTITY_MISMATCH: {
    status: 409,
    message: 'Claude reported a different session identity',
    why: 'The provider must keep the caller-supplied durable UUID unchanged.',
    fix: 'Stop this runtime and inspect the provider identity before retrying.',
  },
  SESSION_PROVIDER_CONFLICT: {
    status: 409,
    message: 'The session belongs to another provider instance',
    why: 'A durable session cannot switch providers or accounts.',
    fix: 'Create a new session for the other provider instance.',
  },
  DISCOVERY_FAILED: {
    status: 502,
    message: 'Claude session discovery failed',
    why: 'The isolated provider metadata process could not return valid session metadata.',
    fix: 'Inspect the provider instance configuration and retry the scan.',
  },
  FORK_POINT_UNAVAILABLE: {
    status: 409,
    message: 'The fork point is not in the source conversation',
    why: "The harness's own history holds fewer turns than the session shows, so the turn to branch after cannot be found.",
    fix: 'Fork from a later turn, or start a new session.',
  },
  HISTORY_FAILED: {
    status: 502,
    message: 'Claude conversation history could not be read',
    why: 'The isolated provider process could not return the local conversation transcript.',
    fix: 'Check that this provider instance can access the session files and retry the import.',
  },
  CLAUDE_CLI_TOO_OLD: {
    status: 409,
    message: ({ version, minimum }: { version: string; minimum: string }) =>
      `Claude Code ${version} is older than the minimum ${minimum}`,
    why: 'Older CLIs lack the result and sign-in fields this app reads, so their turns cannot be reported correctly.',
    fix: 'Update the Claude CLI, or clear the binary path in the provider settings to use the bundled one.',
  },
  CODEX_EXITED: {
    status: 502,
    message: 'The Codex app-server exited',
    why: 'The Codex process ended while this app still had requests waiting on it.',
    fix: 'Send the message again. If it keeps exiting, run `codex app-server` in a terminal to see why.',
  },
  CLAUDE_BINARY_MISSING: {
    status: 500,
    message: 'The configured Claude binary was not found',
    why: 'The provider instance names a binary path that does not resolve to an executable.',
    fix: 'Correct the binary path in the provider settings, or clear it to use the installed `claude`.',
  },
  REQUEST_GONE: {
    status: 410,
    message: 'The agent no longer holds this request',
    why: 'The provider session that asked was restarted or recovered, and its pending requests do not survive that.',
    fix: 'Restart the turn to continue.',
  },
  NOT_INSTALLED: {
    status: 503,
    message: 'The provider CLI is not installed',
    why: 'No executable for this provider was found on the PATH the server runs with.',
    fix: 'Install the CLI, or set its binary path in the provider settings.',
  },
  HISTORY_UNSUPPORTED: {
    status: 400,
    message: 'This provider does not support conversation imports',
    why: 'The configured provider has no local history reader.',
    fix: 'Choose a provider listed in the conversation import settings.',
  },
  RESET_CREDIT_REJECTED: {
    status: 409,
    message: ({ reason }: { reason: string }) => reason,
    why: 'The provider answered the request without spending a credit.',
    fix: 'Refresh usage, then confirm a reset again.',
  },
})

/** Managing MCP servers through each provider CLI’s own config writer. */
export const mcpConfigErrors = defineErrorCatalog('provider', {
  MCP_CONFIG_UNSUPPORTED: {
    status: 409,
    message: 'This provider has no MCP servers to manage.',
    why: 'Only Claude and Codex instances keep MCP server definitions.',
    fix: 'Choose a Claude or Codex provider.',
  },
  MCP_SCOPE_UNSUPPORTED: {
    status: 400,
    message: 'This provider does not keep servers in that place.',
    why: 'Codex keeps its servers in the user config.toml; Claude keeps user, local and project servers.',
    fix: 'Pick one of the places the dialog offers for this provider.',
  },
  MCP_FOLDER_REQUIRED: {
    status: 400,
    message: 'Choose the project folder for this server.',
    why: 'Local and project servers belong to one folder.',
    fix: 'Pick a project, or add the server for your user instead.',
  },
  MCP_FOLDER_MISSING: {
    status: 404,
    message: 'That project folder does not exist on this machine.',
    why: 'Local and project servers are written into a folder the provider CLI can open.',
    fix: 'Pick a project registered on this machine.',
  },
  MCP_NAME_TAKEN: {
    status: 409,
    message: 'A server with that name already exists there.',
    why: 'The provider keeps one definition per name in each place.',
    fix: 'Choose another name, or remove the existing server first.',
  },
  MCP_SERVER_NOT_FOUND: {
    status: 404,
    message: 'That MCP server is not defined there.',
    why: 'The provider’s config has no server with this name in that place; it may have been removed.',
    fix: 'Reload the MCP servers list.',
  },
  MCP_WRITE_FAILED: {
    status: 502,
    message: 'The provider CLI did not save the MCP server change.',
    why: 'Its config writer exited with an error.',
    fix: 'Check the provider’s CLI works from a terminal, then try again.',
  },
  MCP_CONFIG_CHANGED: {
    status: 409,
    message: 'The config changed while it was being saved.',
    why: 'Another editor wrote the same config file after it was read.',
    fix: 'Reload the MCP servers list and make the change again.',
  },
  MCP_SIGN_IN_GONE: {
    status: 404,
    message: 'That sign-in is no longer waiting.',
    why: 'It finished, timed out after five minutes, or the server restarted.',
    fix: 'Start the sign-in again.',
  },
  MCP_SIGN_IN_ADDRESS_MISMATCH: {
    status: 400,
    message: 'That is not the address this sign-in is waiting for.',
    why: 'The page ends on a localhost address with the port and state this sign-in started with.',
    fix: 'Copy the whole address from the tab the sign-in page ended on, then paste it again.',
  },
  MCP_SIGN_IN_FAILED: {
    status: 502,
    message: 'The MCP server sign-in did not finish.',
    why: 'The provider CLI stopped before it received a token.',
    fix: 'Start the sign-in again, and finish it within five minutes.',
  },
  MCP_SIGN_IN_UNSUPPORTED: {
    status: 409,
    message: 'This server does not sign in with a browser.',
    why: 'Only HTTP servers that ask for OAuth sign in this way.',
    fix: 'Set its key or token in the server’s headers or environment instead.',
  },
  MCP_PROBE_FAILED: {
    status: 502,
    message: 'The MCP servers could not be read.',
    why: 'The provider’s CLI did not answer the status request.',
    fix: 'Check the provider is installed and signed in, then reload.',
  },
})

/** The provider has no callback for this request any more; the caller branches on the code. */
export function requestGone(requestKind: 'approval' | 'user-input', requestId: string) {
  return sessionIdentityErrors.REQUEST_GONE({ internal: { requestId, requestKind } })
}

export function isNotInstalledError(error: unknown) {
  return errorStringField(error, 'code') === sessionIdentityErrors.NOT_INSTALLED.code
}

/** Only a definite answer from the provider clears a reset attempt; anything else may have spent it. */
export function isResetCreditRejected(error: unknown) {
  return errorStringField(error, 'code') === sessionIdentityErrors.RESET_CREDIT_REJECTED.code
}
