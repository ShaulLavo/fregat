import { useMessageFileCommit } from '@/features/git/hooks/use-message-file-commit'

/** Renders nothing; mounted with the git store so the commit finishes whatever the sidebar shows. */
export function MessageFileCommit({ rootPath }: { readonly rootPath: string }) {
  useMessageFileCommit(rootPath)

  return null
}
