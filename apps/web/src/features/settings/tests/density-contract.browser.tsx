import { LexicalComposer } from '@lexical/react/LexicalComposer'
import type { ProviderInstanceId } from '@workspace/contracts'
import '@workspace/ui/globals.css'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
} from '@workspace/ui/components/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { createRef, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'

import { ChatInputAttachmentList } from '@/features/chat/components/chat-input-attachment-list'
import { ChatInputCommandMenu } from '@/features/chat/components/chat-input-command-menu'
import { ChatInputEditor } from '@/features/chat/components/chat-input-editor'
import { CHAT_INPUT_EDITOR_NODES } from '@/features/chat/components/chat-input-mention-node'
import { ChatInputSubmitButton } from '@/features/chat/components/chat-input-submit-button'
import { ChatPanelStatus } from '@/features/chat/components/chat-panel-status'
import { ChatPanelHeader } from '@/features/chat/components/chat-panel-header'
import { ModelPickerRail } from '@/features/chat/components/model-picker-rail'
import { TimelineLoadEarlier } from '@/features/chat/components/timeline-load-earlier'
import {
  resetChatInputDraftStore,
  type ChatInputImageAttachment,
} from '@/features/chat/state/chat-input-draft-store'
import { chatInputMentionCommandItems } from '@/features/chat/utils/input-logic'
import { LanguageServerReferencesPane } from '@/features/editor/components/language-server-references-pane'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { Breadcrumbs } from '@/features/file-picker/navigation/breadcrumbs'
import { LocationBar } from '@/features/file-picker/navigation/location-bar'
import { FilePickerSessionActionsContext } from '@/features/file-picker/providers/session-actions-context'
import { UnchangedDiffBanner } from '@/features/git/components/unchanged-diff-banner'
import { LogsToolbar } from '@/features/logs/components/toolbar'
import { SearchControls } from '@/features/workspace/components/search-controls'
import { AppProviders, createTestQueryClient, seedBootMirrorTheme } from '../../../../test/render'

// Every horizontal bar and every vertical icon rail resolves to --bar-height.
// Naming it once is the contract: a bar that disagrees is the header-jump bug
// this suite exists to catch.
const BAR_HEIGHT = { compact: 36, cozy: 40 } as const

let root: Root | null = null

afterEach(() => {
  flushSync(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  delete document.documentElement.dataset.density
  localStorage.clear()
  resetChatInputDraftStore()
})

test('consumer geometry stays authoritative in both densities', async () => {
  mount(
    <Dialog open>
      <DialogContent className='gap-0 p-0' showCloseButton={false}>
        <DialogTitle>Density contract</DialogTitle>
        <Input aria-label='Explicit input' className='h-6 px-1.5' />
        <Input aria-label='Default input' />
        <InputGroup data-testid='input-group'>
          <InputGroupAddon>
            Path
            <InputGroupButton aria-label='Input group action' size='icon-sm' />
          </InputGroupAddon>
          <InputGroupInput aria-label='Grouped input' />
        </InputGroup>
        <InputGroup data-testid='textarea-group'>
          <InputGroupTextarea aria-label='Grouped textarea' />
        </InputGroup>
        <Button className='h-auto gap-0 p-0' data-testid='flexible-button'>
          <span>
            First line
            <br />
            Second line
          </span>
        </Button>
        <Button data-testid='default-button'>Default button</Button>
        <DialogFooter data-testid='dialog-footer'>
          <Button>Cancel</Button>
          <Button>Save</Button>
        </DialogFooter>
        <DialogFooter className='gap-0' data-testid='explicit-dialog-footer'>
          <Button>Previous</Button>
          <Button>Next</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  )
  await expect.poll(() => document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()
  finishAnimations()

  const dialog = requiredElement<HTMLElement>('[data-slot="dialog-content"]')
  const explicitInput = inputByLabel('Explicit input')
  const defaultInput = inputByLabel('Default input')
  const flexibleButton = requiredElement<HTMLElement>('[data-testid="flexible-button"]')
  const defaultButton = requiredElement<HTMLElement>('[data-testid="default-button"]')
  const dialogFooter = requiredElement<HTMLElement>('[data-testid="dialog-footer"]')
  const explicitDialogFooter = requiredElement<HTMLElement>(
    '[data-testid="explicit-dialog-footer"]',
  )
  const inputGroup = requiredElement<HTMLElement>('[data-testid="input-group"]')
  const inputGroupAddon = requiredElement<HTMLElement>('[data-slot="input-group-addon"]')
  const inputGroupButton = buttonByLabel('Input group action')
  const groupedTextarea = requiredElement<HTMLTextAreaElement>(
    'textarea[aria-label="Grouped textarea"]',
  )

  setDensity('compact')
  expect(boxSpacing(dialog)).toEqual({ gap: 0, padding: 0 })
  expect(explicitInput.getBoundingClientRect().height).toBe(24)
  expect(defaultInput.getBoundingClientRect().height).toBe(28)
  expect(defaultButton.getBoundingClientRect().height).toBe(28)
  expect(pixelValue(getComputedStyle(dialogFooter).gap)).toBe(6)
  expect(pixelValue(getComputedStyle(explicitDialogFooter).gap)).toBe(0)
  expect(inputGroup.getBoundingClientRect().height).toBe(28)
  expect(inputGroupButton.getBoundingClientRect().height).toBe(24)
  expect(pixelValue(getComputedStyle(inputGroupAddon).paddingTop)).toBe(4)
  expect(pixelValue(getComputedStyle(groupedTextarea).paddingTop)).toBe(6)
  const compactFlexibleHeight = flexibleButton.getBoundingClientRect().height
  expect(compactFlexibleHeight).toBeGreaterThan(28)
  expect(flexibleButton.scrollHeight).toBeLessThanOrEqual(flexibleButton.clientHeight)

  setDensity('cozy')
  expect(boxSpacing(dialog)).toEqual({ gap: 0, padding: 0 })
  expect(explicitInput.getBoundingClientRect().height).toBe(24)
  expect(defaultInput.getBoundingClientRect().height).toBe(32)
  expect(defaultButton.getBoundingClientRect().height).toBe(32)
  expect(pixelValue(getComputedStyle(dialogFooter).gap)).toBe(8)
  expect(pixelValue(getComputedStyle(explicitDialogFooter).gap)).toBe(0)
  expect(inputGroup.getBoundingClientRect().height).toBe(32)
  expect(inputGroupButton.getBoundingClientRect().height).toBe(28)
  expect(pixelValue(getComputedStyle(inputGroupAddon).paddingTop)).toBe(6)
  expect(pixelValue(getComputedStyle(groupedTextarea).paddingTop)).toBe(8)
  expect(flexibleButton.getBoundingClientRect().height).toBe(compactFlexibleHeight)
  expect(flexibleButton.scrollHeight).toBeLessThanOrEqual(flexibleButton.clientHeight)
})

test('full-bleed popovers remain full-bleed in both densities', async () => {
  mount(
    <Popover open>
      <PopoverTrigger render={<button type='button' />}>Open</PopoverTrigger>
      <PopoverContent className='gap-0 p-0'>Full-bleed content</PopoverContent>
    </Popover>,
  )
  await expect.poll(() => document.querySelector('[data-slot="popover-content"]')).not.toBeNull()
  finishAnimations()
  const popover = requiredElement<HTMLElement>('[data-slot="popover-content"]')

  setDensity('compact')
  expect(boxSpacing(popover)).toEqual({ gap: 0, padding: 0 })

  setDensity('cozy')
  expect(boxSpacing(popover)).toEqual({ gap: 0, padding: 0 })
})

test('persistent app chrome changes compactly and leaves content text unchanged', () => {
  mount(
    <TooltipProvider delay={0}>
      <section data-testid='chat-header'>
        <ChatPanelHeader
          activeSessionId={null}
          creating={false}
          disabled={false}
          sessions={[]}
          onNewChat={() => undefined}
          onSelectSession={() => undefined}
        />
      </section>
      <ChatInputSubmitButton
        disabledReason={null}
        pendingAction={null}
        busy={false}
        disabled={false}
        sendDisabled={false}
        onStop={() => undefined}
        onSubmit={() => Promise.resolve(true)}
      />
      <section data-testid='chat-panel-status'>
        <ChatPanelStatus
          createError='Could not create chat'
          projectError={null}
          shellError={null}
        />
      </section>
      <section className='relative h-12' data-testid='timeline-load-earlier'>
        <TimelineLoadEarlier error={null} pending={false} onLoad={() => undefined} />
      </section>
      <section data-testid='logs-toolbar'>
        <LogsToolbar
          areas={[]}
          filters={{
            area: 'all',
            level: 'all',
            search: '',
            slowMs: 1_000,
            source: 'all',
            timeRange: '1h',
          }}
          refreshing={false}
          sources={[]}
          onFiltersChange={() => undefined}
          onRefresh={() => undefined}
        />
      </section>
      <section data-testid='unchanged-banner'>
        <UnchangedDiffBanner message='No textual changes' />
      </section>
    </TooltipProvider>,
  )

  const header = requiredElement<HTMLElement>('[data-testid="chat-header"] > header')
  const submit = buttonByLabel('Send message')
  const chatStatus = requiredElement<HTMLElement>('[data-testid="chat-panel-status"] > div')
  const chatStatusContent = chatStatus.firstElementChild as HTMLElement
  const loadEarlier = requiredElement<HTMLButtonElement>(
    '[data-testid="timeline-load-earlier"] button',
  )
  const logsToolbar = requiredElement<HTMLElement>('[data-testid="logs-toolbar"] > div')
  const timeRange = selectByLabel('Log time range')
  const banner = requiredElement<HTMLElement>('[data-testid="unchanged-banner"] [role="status"]')
  const headerFontSize = getComputedStyle(header.querySelector('div > div')!).fontSize
  const statusFontSize = getComputedStyle(chatStatus).fontSize
  const loadEarlierFontSize = getComputedStyle(loadEarlier).fontSize

  setDensity('compact')
  expect(header.getBoundingClientRect().height).toBe(BAR_HEIGHT.compact)
  expect(submit.getBoundingClientRect().height).toBe(24)
  expect(pixelValue(getComputedStyle(chatStatus).paddingLeft)).toBe(8)
  expect(pixelValue(getComputedStyle(chatStatus).paddingTop)).toBe(6)
  expect(pixelValue(getComputedStyle(chatStatusContent).gap)).toBe(4)
  expect(loadEarlier.getBoundingClientRect().height).toBe(24)
  expect(pixelValue(getComputedStyle(loadEarlier).paddingLeft)).toBe(8)
  expect(timeRange.getBoundingClientRect().height).toBe(24)
  expect(pixelValue(getComputedStyle(logsToolbar).paddingTop)).toBe(4)
  expect(pixelValue(getComputedStyle(banner).paddingTop)).toBe(4)

  setDensity('cozy')
  expect(header.getBoundingClientRect().height).toBe(BAR_HEIGHT.cozy)
  expect(submit.getBoundingClientRect().height).toBe(28)
  expect(pixelValue(getComputedStyle(chatStatus).paddingLeft)).toBe(10)
  expect(pixelValue(getComputedStyle(chatStatus).paddingTop)).toBe(8)
  expect(pixelValue(getComputedStyle(chatStatusContent).gap)).toBe(6)
  expect(loadEarlier.getBoundingClientRect().height).toBe(28)
  expect(pixelValue(getComputedStyle(loadEarlier).paddingLeft)).toBe(10)
  expect(timeRange.getBoundingClientRect().height).toBe(28)
  expect(pixelValue(getComputedStyle(logsToolbar).paddingTop)).toBe(6)
  expect(pixelValue(getComputedStyle(banner).paddingTop)).toBe(6)
  expect(getComputedStyle(header.querySelector('div > div')!).fontSize).toBe(headerFontSize)
  expect(getComputedStyle(chatStatus).fontSize).toBe(statusFontSize)
  expect(getComputedStyle(loadEarlier).fontSize).toBe(loadEarlierFontSize)
})

test('custom composer, picker, search, and references chrome follows density', async () => {
  setDensity('compact')
  seedBootMirrorTheme('dark')
  const commandItems = chatInputMentionCommandItems([
    { id: 'path:app.tsx', label: 'app.tsx', path: 'src/app.tsx', type: 'file' },
  ])
  const attachment: ChatInputImageAttachment = {
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    id: 'density-attachment',
    mimeType: 'image/png',
    name: 'density.png',
    previewUrl: 'data:image/png;base64,iVBORw0KGgo=',
    sizeBytes: 2_048,
    type: 'image',
  }

  mount(
    <AppProviders queryClient={createTestQueryClient()}>
      <EditorStateProvider>
        <TooltipProvider delay={0}>
          <LexicalComposer
            initialConfig={{
              namespace: 'density-contract',
              nodes: CHAT_INPUT_EDITOR_NODES,
              onError: (error) => {
                throw error
              },
            }}
          >
            <ChatInputEditor
              busy={false}
              disabled={false}
              draftKey='density-contract'
              hasStagedContent={false}
              placeholder='Message'
              rootPath='/repo'
              sendButtonRef={createRef<HTMLButtonElement>()}
              submitting={false}
              trigger={null}
              onCommandMenuCommit={() => false}
              onCommandMenuMove={() => false}
              onEditorReady={() => undefined}
              onImageFiles={() => undefined}
              onSubmitRequest={() => Promise.resolve(false)}
              onTriggerChange={() => undefined}
            />
          </LexicalComposer>
          <ChatInputAttachmentList
            attachments={[attachment]}
            disabled={false}
            onRemove={() => undefined}
          />
          <ChatInputCommandMenu
            activeItemId={commandItems[0]?.id ?? null}
            emptyLabel='No matches'
            isLoading={false}
            items={commandItems}
            triggerKind='mention'
            onActiveItemChange={() => undefined}
            onDismiss={() => undefined}
            onSelect={() => undefined}
          />
          <section className='h-40' data-testid='model-rail'>
            <ModelPickerRail
              activeProviderInstanceId={'provider' as ProviderInstanceId}
              groups={[]}
              onSelect={() => undefined}
            />
          </section>
          <section data-testid='search-controls'>
            <SearchControls rootPath='/repo' showOpenInEditorButton={false} />
          </section>
          <section className='h-40' data-testid='references-pane'>
            <LanguageServerReferencesPane
              references={{ targets: [], uri: 'file:///repo/app.tsx' }}
              rootPath='/repo'
              onClose={() => undefined}
              onOpenReference={() => undefined}
              onPreviewReference={() => undefined}
            />
          </section>
        </TooltipProvider>
      </EditorStateProvider>
    </AppProviders>,
  )
  await expect
    .poll(() => document.querySelector('[data-chat-input-command-item-id]'))
    .not.toBeNull()
  finishAnimations()

  const editorShell = requiredElement<HTMLElement>(
    '[data-testid="chat-input-editor"]',
  ).parentElement!
  const attachmentStrip = requiredElement<HTMLElement>(
    '[role="group"][aria-label="Image attachments"]',
  )
  const commandItem = requiredElement<HTMLElement>('[data-chat-input-command-item-id]')
  const modelRail = requiredElement<HTMLElement>('[data-testid="model-rail"] > div')
  const searchShell = requiredElement<HTMLElement>('[data-testid="search-controls"] > div')
  // The workspace search is an InputGroup now: the group carries the density
  // height and its addons reserve their own space, so there is no hand-written
  // padding on the input left to assert.
  const searchField = requiredElement<HTMLElement>(
    '[data-slot="input-group"]:has(input[aria-label="Search workspace"])',
  )
  const referencesHeader = requiredElement<HTMLElement>(
    '[data-testid="references-pane"] aside > div:first-child',
  )

  expect(pixelValue(getComputedStyle(editorShell).paddingLeft)).toBe(12)
  expect(pixelValue(getComputedStyle(editorShell).paddingTop)).toBe(12)
  expect(pixelValue(getComputedStyle(attachmentStrip).paddingLeft)).toBe(8)
  expect(pixelValue(getComputedStyle(commandItem).paddingTop)).toBe(6)
  expect(modelRail.getBoundingClientRect().width).toBe(BAR_HEIGHT.compact)
  expect(pixelValue(getComputedStyle(searchShell).paddingTop)).toBe(4)
  expect(searchField.getBoundingClientRect().height).toBe(24)
  expect(referencesHeader.getBoundingClientRect().height).toBe(BAR_HEIGHT.compact)

  setDensity('cozy')
  expect(pixelValue(getComputedStyle(editorShell).paddingLeft)).toBe(16)
  expect(pixelValue(getComputedStyle(editorShell).paddingTop)).toBe(16)
  expect(pixelValue(getComputedStyle(attachmentStrip).paddingLeft)).toBe(10)
  expect(pixelValue(getComputedStyle(commandItem).paddingTop)).toBe(8)
  expect(modelRail.getBoundingClientRect().width).toBe(BAR_HEIGHT.cozy)
  expect(pixelValue(getComputedStyle(searchShell).paddingTop)).toBe(6)
  expect(searchField.getBoundingClientRect().height).toBe(28)
  expect(referencesHeader.getBoundingClientRect().height).toBe(BAR_HEIGHT.cozy)
})

test('file-picker path controls and breadcrumbs follow density', () => {
  setDensity('compact')
  const actions = {
    jumpTo: () => undefined,
    navigateTo: () => undefined,
    revealEntry: () => undefined,
    selectEntry: () => undefined,
  }
  mount(
    <TooltipProvider delay={0}>
      <FilePickerSessionActionsContext value={actions}>
        <LocationBar
          currentPath='/repo/src'
          draft='/repo/src'
          error={null}
          inputRef={createRef<HTMLInputElement>()}
          isEditing
          isPending={false}
          onCancel={() => undefined}
          onChange={() => undefined}
          onEdit={() => undefined}
          onSubmit={() => undefined}
        />
        <section data-testid='breadcrumbs'>
          <Breadcrumbs currentPath='/repo/src' />
        </section>
      </FilePickerSessionActionsContext>
    </TooltipProvider>,
  )
  const pathInput = inputByLabel('Folder path')
  const breadcrumb = requiredElement<HTMLButtonElement>('[data-testid="breadcrumbs"] button')

  expect(pathInput.getBoundingClientRect().height).toBe(28)
  expect(breadcrumb.getBoundingClientRect().height).toBe(24)

  setDensity('cozy')
  expect(pathInput.getBoundingClientRect().height).toBe(32)
  expect(breadcrumb.getBoundingClientRect().height).toBe(28)
})

function mount(children: ReactNode) {
  const host = document.createElement('main')
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => root?.render(children))
}

function setDensity(density: 'compact' | 'cozy') {
  document.documentElement.dataset.density = density
}

function boxSpacing(element: HTMLElement) {
  const style = getComputedStyle(element)

  return {
    gap: pixelValue(style.gap),
    padding: pixelValue(style.paddingTop),
  }
}

function inputByLabel(label: string) {
  return requiredElement<HTMLInputElement>(`input[aria-label="${label}"]`)
}

// The log filters are the Select primitive now, not native <select>: the trigger
// is a button, so the element type changed even though its height did not.
function selectByLabel(label: string) {
  return requiredElement<HTMLButtonElement>(`[data-slot="select-trigger"][aria-label="${label}"]`)
}

function buttonByLabel(label: string) {
  return requiredElement<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

function requiredElement<TElement extends Element>(selector: string) {
  const element = document.querySelector<TElement>(selector)
  expect(element, `Missing test element: ${selector}`).not.toBeNull()

  return element!
}

function pixelValue(value: string) {
  return Number.parseFloat(value)
}

// An infinite animation cannot be finished — skeleton-sweep is one, and calling
// finish() on it throws. Pause those instead; finish the ones that do end.
function finishAnimations() {
  for (const animation of document.getAnimations()) {
    const endTime = animation.effect?.getComputedTiming().endTime
    if (endTime === Number.POSITIVE_INFINITY) {
      animation.pause()
      continue
    }
    animation.finish()
  }
}
