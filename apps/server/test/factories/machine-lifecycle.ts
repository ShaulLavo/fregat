import { onTestFinished } from 'vitest'
import { MachineService } from '../../src/machines/service'
import { fakeSsh, machine } from './ssh'

export async function lifecycleMachineFixture() {
  const boundary = await fakeSsh()
  let announceStop = () => {}
  const stopping = new Promise<void>((resolve) => {
    announceStop = resolve
  })
  let releaseStop = () => {}
  let heldStop = false
  const service = new MachineService({
    environmentId: 'machine-lifecycle-test',
    webOrigin: 'http://localhost:3000',
    readMachines: () => ({ first: { ...machine, target: 'first-host' }, second: machine }),
    fetcher: boundary.fetcher,
    localPort: boundary.localPort,
    spawn(command) {
      if (
        heldStop ||
        !command.includes('first-host') ||
        !command.at(-1)?.includes('await withLeaseLock(stop);')
      )
        return boundary.spawn(command)
      heldStop = true
      const child = Bun.spawn({
        cmd: [process.execPath, '-e', 'await Bun.stdin.text()'],
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      releaseStop = () => {
        child.stdin.end()
      }
      announceStop()
      return child
    },
  })
  onTestFinished(async () => {
    releaseStop()
    await service.close()
  })
  return { ...boundary, service, stopping, releaseStop: () => releaseStop() }
}
