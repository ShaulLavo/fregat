import { semanticTokensClientCapability, SEMANTIC_TOKEN_TYPES } from '@singapore-editor/lsp'
import type { lsp } from '@singapore-editor/lsp'

import { semanticTokenProfileFor } from '@/features/editor/utils/semantic-token-servers'

/**
 * The client capabilities this app declares to one server: the
 * `textDocument.semanticTokens` block plus hierarchical document symbols.
 *
 * **Its only input is the server id.** Not the document, not the root, not the
 * viewport, not a setting read at call time — and that signature is the
 * invariant rather than a simplification.
 *
 * The reason is pooling. `initialize` is sent **once per pooled backend**, and
 * its result is cached and replayed to every client that connects later, so the
 * legend every tab in a root sees is the one negotiated by whichever tab
 * happened to open first. At least two servers compute their advertised legend
 * *from* the declared block — terraform-ls intersects its token types against
 * the client's array, and ocaml-lsp returns no provider at all unless the client
 * declares `formats: ['relative']` and `requests.full`. So a block that varied
 * per tab, per document or per viewport would make the whole root's colour
 * depend on which file someone opened first. Keyed on the server id it cannot:
 * the pool key is the server id plus the root, so every client of one backend
 * shares one id and therefore one byte-identical block.
 *
 * That is also why `lsp.semanticTokens.enabled` is **not** read here. It gates
 * requests, one layer up. Reading it at capability-build time would make the
 * declared block a function of when a tab opened, which is the same defect in a
 * different disguise.
 *
 * Three flags are absent rather than `false`, and the absence is the statement:
 *
 * - `multilineTokenSupport` — this app does not declare it yet, so no conformant
 *   server sends a token crossing a newline. The editor's builder will accept
 *   the flag; turning it on here is one line and one look at a real file.
 * - `overlappingTokenSupport` — the editor truncates the earlier of two
 *   overlapping spans rather than layering them, so claiming it would invite a
 *   server to send overlaps on a promise nothing keeps. The builder offers no
 *   way to declare it.
 * - `dynamicRegistration` — `deno`, `dart` and `tinymist` answer `initialize`
 *   with *no* provider when a client declares it, expecting to register later
 *   through `client/registerCapability`; this proxy answers that request `null`
 *   itself and forwards nothing, so the registration would never arrive and a
 *   working server would go silent.
 */
export function clientCapabilitiesForServer(serverId: string): lsp.ClientCapabilities {
  const profile = semanticTokenProfileFor(serverId)

  const textDocument = semanticTokensClientCapability({
    augmentsSyntaxTokens: profile.augmentsSyntaxTokens,
    // Required by ocaml-lsp before it will advertise a provider at all, and the
    // only format the protocol defines, so it is harmless everywhere else.
    formats: ['relative'],
    requests: profile.requests,
    // The standard list, declared explicitly rather than left to the builder's
    // default: this is the one field a server can observe and intersect
    // against, so it should be a decision this file records rather than one it
    // inherits.
    tokenTypes: SEMANTIC_TOKEN_TYPES,
  })

  return {
    ...textDocument,
    textDocument: {
      ...textDocument.textDocument,
      // Without this `documentSymbol` answers flat, with name-only ranges.
      documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    },
    workspace: {
      semanticTokens: {
        /**
         * Without this the refresh route does not exist.
         *
         * A conformant server only sends `workspace/semanticTokens/refresh` to a
         * client that asked for it, and the editor's builder emits a
         * `textDocument` block only — so the proxy's downgrade, the notification
         * handler and everything behind them would have been unreachable code
         * waiting for a request nobody would send.
         *
         * Declared honestly rather than optimistically: this app really does act
         * on it. The proxy answers the server itself and re-emits the method to
         * every pooled client as a notification, and each browser clears its
         * layer and asks once.
         */
        refreshSupport: true,
      },
    },
  }
}

/**
 * What this client calls itself.
 *
 * Not decoration. `zls` branches on the name and turns `full` off for
 * `"Visual Studio Code"` and `"Code - OSS"`, so the one requirement is that this
 * is never either of those. The editor's client already sends this value; it is
 * named here so the plugin passes it explicitly and a later refactor in the
 * editor package cannot change it silently.
 */
export const LANGUAGE_SERVER_CLIENT_INFO = { name: '@singapore-editor/lsp' } as const
