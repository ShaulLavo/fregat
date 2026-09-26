const VERSION_TIMEOUT_MS = 5_000

export function parseCliVersion(output: string): string | null {
  return /\d+\.\d+\.\d+/.exec(output)?.[0] ?? null
}

/** `null` when the binary did not answer `--version` with a version. */
export async function readCliVersion(executablePath: string, env: NodeJS.ProcessEnv) {
  try {
    const child = Bun.spawn([executablePath, '--version'], {
      env,
      stderr: 'ignore',
      stdin: 'ignore',
      stdout: 'pipe',
      timeout: VERSION_TIMEOUT_MS,
    })
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])

    return exitCode === 0 ? parseCliVersion(stdout) : null
  } catch {
    return null
  }
}
