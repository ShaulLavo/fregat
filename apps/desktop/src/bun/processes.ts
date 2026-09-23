export async function commandOutput(command: string[]) {
  const child = Bun.spawn({
    cmd: command,
    stderr: 'ignore',
    stdout: 'pipe',
  })
  const output = await new Response(child.stdout).text()
  await child.exited

  return output
}

/** `ps` start time: with the pid, the identity that survives pid reuse. */
export async function processStart(pid: number) {
  const output = await commandOutput(['ps', '-p', String(pid), '-o', 'lstart='])
  return output.trim() || null
}

/** The executable name only: a full command line can carry another program's secrets. */
export async function processName(pid: number) {
  const output = await commandOutput(['ps', '-p', String(pid), '-o', 'comm='])
  return output.trim()
}

/** A process group lives until its last member exits, even after its leader. */
export function groupAlive(pgid: number) {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

export function signalGroup(pgid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pgid, signal)
  } catch {
    // The group emptied between the check and the signal.
  }
}
