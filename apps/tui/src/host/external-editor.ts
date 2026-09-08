import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { EditTextRequest } from '@/host/providers/actions-context'
import { createTuiError } from '@/host/utils/structured-errors'

export function externalEditorExecutable(
  configured: string,
  environmentEditor = process.env.EDITOR,
) {
  return configured.trim() || environmentEditor?.trim() || 'vi'
}

export async function runExternalEditor({
  text,
  executable,
  signal,
  filename: requestedName,
}: EditTextRequest) {
  signal.throwIfAborted()
  await mkdir('/work/tmp', { recursive: true })
  const directory = await mkdtemp('/work/tmp/platform-editor-')
  try {
    await chmod(directory, 0o700)
    const basename = path.basename(requestedName ?? 'settings.json')
    const filename = path.join(
      directory,
      basename === '.' || basename === '..' ? 'document.txt' : basename,
    )
    await writeFile(filename, text, { mode: 0o600 })
    signal.throwIfAborted()
    await runEditorProcess(executable, filename, signal)
    signal.throwIfAborted()
    return await readFile(filename, 'utf8')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function runEditorProcess(executable: string, filename: string, signal: AbortSignal) {
  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn([executable, filename], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
  } catch (error) {
    throw createTuiError(
      'Could not start the external editor.',
      'Set editor.externalEditor to one executable path. Arguments and shell syntax are not supported.',
      error instanceof Error ? error : undefined,
    )
  }
  const cancel = () => child.kill('SIGKILL')
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  try {
    const code = await child.exited
    signal.throwIfAborted()
    if (code === 0) return
    throw createTuiError(
      `External editor exited with status ${code}.`,
      'Retry editing, or cancel to keep the current content.',
    )
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}
