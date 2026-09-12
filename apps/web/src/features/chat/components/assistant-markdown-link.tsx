import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import type { ComponentProps, MouseEvent } from 'react'

import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'

import { externalLinkHost } from '@/features/chat/utils/markdown-external-links'
import { findMarkdownFragmentTarget } from '@/features/chat/utils/markdown-fragment-links'
import { MarkdownLinkFavicon } from './markdown-link-favicon'
import { MarkdownLinkMenu } from './markdown-link-menu'

type AssistantMarkdownLinkProps = Omit<ComponentProps<'a'>, 'ref'> & { node?: unknown }

/**
 * Replaces the renderer's own link element for two reasons: it renders links as
 * buttons, which strips the destination out of the DOM (and out of any copied
 * selection), and a link that leaves the workspace deserves to say where it
 * goes before it is clicked.
 */
export function AssistantMarkdownLink({
  children,
  className,
  href = '',
  node,
  rel,
  target,
  ...props
}: AssistantMarkdownLinkProps) {
  void node

  const contextMenu = useContextMenu()
  const host = externalLinkHost(href)

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const fragmentTarget = findMarkdownFragmentTarget(event.currentTarget, href)
    if (!fragmentTarget) return

    event.preventDefault()
    fragmentTarget.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // The message bubble opens its own menu on right-click, and the innermost
  // target wins: a link's actions are about the link, not the message.
  function handleContextMenu(event: MouseEvent<HTMLAnchorElement>) {
    if (!host) return

    event.stopPropagation()
    contextMenu.openAtEvent(event, event.currentTarget)
  }

  const anchor = (
    <a
      className={cn(
        'text-primary decoration-primary/40 hover:decoration-primary wrap-anywhere font-medium underline underline-offset-2',
        className,
      )}
      data-chat-link-host={host ?? undefined}
      data-streamdown='link'
      href={href}
      rel={host ? 'noopener noreferrer' : rel}
      target={host ? '_blank' : target}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      {...props}
    >
      {host ? <MarkdownLinkFavicon host={host} /> : null}
      {children}
    </a>
  )

  if (!host) return anchor

  return (
    <>
      <Tooltip>
        <TooltipTrigger render={anchor} />
        <TooltipContent className='max-w-[min(36rem,80vw)] wrap-anywhere'>{href}</TooltipContent>
      </Tooltip>
      {contextMenu.open ? (
        <MarkdownLinkMenu
          anchor={contextMenu.anchor}
          href={href}
          onOpenChange={contextMenu.onOpenChange}
        />
      ) : null}
    </>
  )
}
