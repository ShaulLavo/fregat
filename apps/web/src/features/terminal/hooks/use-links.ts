import { filesystemPath } from '@/lib/documents/utils/identity'
import type { Terminal, ProvidedLink } from 'ghostty-webgpu'
import { useEffect, useEffectEvent, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { clientLogContext } from '@/lib/environments/state/log-context'

import { useOpenFileReference } from '@/features/chat/hooks/use-open-file-reference'
import {
  readTerminalSnapshotPathLinks,
  type TerminalSnapshotPathLink,
} from '@/features/terminal/utils/links'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { log } from '@/lib/client-logging'
import { statPath } from '@/lib/file-server'
import { isFileEntry } from '@/lib/file-system-types'

/** A click that has to wait on the filesystem still has to feel like a click. */
const STAT_TIMEOUT_MS = 2000

/**
 * Ctrl/Cmd-click a path in terminal output to open it in the editor. ghostty
 * already ships URL and OSC 8 providers, so this one adds file paths only, and
 * it opens them through the transcript's file-reference command rather than
 * inventing a second way in.
 */
export function useTerminalLinks(rootPath: string) {
  const { openFileReference } = useOpenFileReference()
  const client = clientForQueryClient(useQueryClient())
  const intentRef = useRef(0)

  useEffect(
    () => () => {
      intentRef.current += 1
    },
    [client, rootPath],
  )

  // Reading the open command through an effect event keeps a click pointed at
  // the current editor instead of the one that existed at registration.
  const openTerminalPathLink = useEffectEvent(async (link: TerminalSnapshotPathLink) => {
    const intentId = ++intentRef.current
    const owner = clientLogContext(client)
    const target = await statTerminalLinkTarget(link.reference.path, client)
    if (intentRef.current !== intentId) return

    log.info({
      ...owner,
      action: 'terminal.link.open',
      area: 'terminal',
      column: link.reference.column,
      isFile: target.isFile,
      line: link.reference.line,
      path: link.reference.path,
      // A relative path is the one resolution we cannot verify up front.
      relative: !link.text.startsWith('/'),
      rootPath,
    })

    if (!target.isFile) {
      reportError(terminalLinkError(target.error))
      return
    }

    // Open the path the stat just confirmed: the server form, whatever root the editor has.
    openFileReference({ ...link.reference, path: workspaceRequestPath(link.reference.path) })
  })

  return (terminal: Terminal) => {
    terminal.registerLinkProvider({
      provideLinks: (line) => {
        const links = readTerminalSnapshotPathLinks({
          line,
          rootPath,
        })
        if (links.length === 0) return undefined

        // Registered from panel's terminal-ready effect event; ghostty calls it on click, after commit.
        // oxlint-disable-next-line react/rules-of-hooks
        return links.map((link) => ghosttyLink(link, openTerminalPathLink))
      },
    })
  }
}

function ghosttyLink(
  link: TerminalSnapshotPathLink,
  open: (link: TerminalSnapshotPathLink) => void,
): ProvidedLink<Event> {
  return {
    activate: () => open(link),
    range: link.range,
    text: link.text,
  }
}

/**
 * The shell's cwd is invisible from here — ghostty-webgpu reports no OSC 7 — so a
 * relative path resolves against the panel's root and is wrong for anything the
 * user `cd`-ed into. Confirming the file exists is what keeps that from opening
 * a tab on a path nothing ever wrote; the click reports the miss instead.
 */
async function statTerminalLinkTarget(path: string, client: Client) {
  try {
    const entry = await statPath(
      filesystemPath(workspaceRequestPath(path)),
      AbortSignal.timeout(STAT_TIMEOUT_MS),
      client,
    )

    return { error: null, isFile: isFileEntry(entry) }
  } catch (error) {
    return { error, isFile: false }
  }
}

/**
 * The fs routes address every path relative to the server's workspace root and
 * reject an absolute one outright; the shared resolver hands back the OS-shaped
 * form. One leading slash is the whole difference.
 */
function workspaceRequestPath(path: string) {
  return path.replace(/^\/+/u, '')
}

function terminalLinkError(error: unknown) {
  if (error) return toClientError(error)

  return {
    category: 'not_a_file' as const,
    message: 'That path is a folder. Open a file inside it.',
  }
}
