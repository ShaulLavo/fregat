import { TerminalHostClient } from '../../../server/src/terminal/host-client'
import { stopTerminalHost } from '../../../server/src/terminal-host/identity'
import { leaseChild, releaseChild } from './child-lease'

/** The desktop holds this connection until quit; server restarts only detach their own. */
export class DesktopTerminalHost {
  private readonly client: TerminalHostClient
  private pid: number | null = null

  constructor(
    private readonly stateRoot: string,
    private readonly leaseFile: string,
  ) {
    this.client = new TerminalHostClient({ stateRoot })
  }

  async start() {
    const host = await this.client.host()
    this.pid = host.pid
    await leaseChild(this.leaseFile, 'terminal-host', host.pid, 'process')
  }

  async stop() {
    if (this.pid === null) return
    await this.client.shutdown()
    await stopTerminalHost(this.stateRoot)
    await releaseChild(this.leaseFile, this.pid)
    this.pid = null
  }
}
