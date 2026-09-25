import type { ServerSocket } from '@workspace/client-core/transport/socket'
import type { TerminalClientMessage } from '@workspace/contracts'

const WEB_SOCKET_OPEN = 1

export function encodeTerminalClientMessage(message: TerminalClientMessage) {
  return message.type === 'input' ? message.data : JSON.stringify(message)
}

export function sendTerminalClientMessage(
  socket: ServerSocket | null,
  message: TerminalClientMessage,
) {
  if (!socket || socket.readyState !== WEB_SOCKET_OPEN) return false

  socket.send(encodeTerminalClientMessage(message))
  return true
}
