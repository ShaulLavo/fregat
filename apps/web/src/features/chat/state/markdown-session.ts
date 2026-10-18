import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query'
import type { MarkdownSessionFactory } from '@workspace/markdown/utils/session'

import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { chatMarkdownQueryKeys } from '@/features/chat/utils/query-keys'
import { markdownRuntimeError } from '@/features/chat/utils/module-errors'
import { runMutation } from '@/lib/mutations/run'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

type MarkdownRuntime = { readonly createSession: MarkdownSessionFactory }

export function chatMarkdownQueryOptions(client: QueryClient = resourceQueryClient) {
  const load = mutationOptions({
    mutationKey: chatMutationKeys.markdownRuntime,
    scope: { id: 'chat.markdown-runtime' },
    networkMode: 'always',
    retry: false,
    mutationFn: async (): Promise<MarkdownRuntime> => {
      const cached = client.getQueryData<MarkdownRuntime>(chatMarkdownQueryKeys.runtime)
      if (cached) return cached
      return initializeMarkdown()
    },
    onSuccess: (runtime) => {
      client.setQueryData(chatMarkdownQueryKeys.runtime, runtime)
    },
  })
  return queryOptions({
    queryKey: chatMarkdownQueryKeys.runtime,
    staleTime: 'static',
    gcTime: Infinity,
    structuralSharing: false,
    networkMode: 'always',
    retry: false,
    retryOnMount: false,
    queryFn: () => runMutation(client, load, undefined),
  })
}

async function initializeMarkdown(): Promise<MarkdownRuntime> {
  try {
    const [candidate, parser, grammar, resolver] = await Promise.all([
      import('@workspace/markdown/utils/tree-sitter-session'),
      import('web-tree-sitter/web-tree-sitter.wasm?url'),
      import('tree-sitter-md/tree-sitter-markdown.wasm?url'),
      import('tree-sitter-md/tree-sitter-md.wasm?url'),
    ])
    await candidate.initializeTreeSitterMarkdown({
      parser: { locateFile: () => parser.default },
      grammar: grammar.default,
      resolver: resolver.default,
    })
    return { createSession: candidate.createTreeSitterMarkdownSession }
  } catch (cause) {
    throw markdownRuntimeError(cause)
  }
}
