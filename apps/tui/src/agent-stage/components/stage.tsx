import type { ProviderSnapshot } from '@workspace/contracts'
import { writeFile } from 'node:fs/promises'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRenderer, useTerminalDimensions } from '@opentui/react'
import {
  createApprovalRespondCommand,
  createSessionInterruptCommand,
  createUserInputRespondCommand,
} from '@workspace/client-core/chat/commands'
import {
  contextUsageForActivities,
  formatContextTokens,
} from '@workspace/client-core/chat/context-usage'
import { ChangedFiles } from '@/agent-stage/components/changed-files'
import { PromptInbox } from '@/agent-stage/components/inbox'
import { nextRuntimeMode } from '@/agent-stage/utils/modes'
import { derivePendingApprovals } from '@workspace/client-core/chat/pending-approvals'
import { derivePendingUserInputs } from '@workspace/client-core/chat/pending-user-input'
import type { StageTarget } from '@/agent/utils/target'
import type { SessionState, SettingsSession } from '@/connection/state/session'
import { useStage } from '@/agent-stage/hooks/use-stage'
import { Composer } from '@/agent-stage/components/composer'
import { Timeline } from '@/agent-stage/components/timeline'
import { Approval } from '@/agent-stage/components/approval'
import { Question } from '@/agent-stage/components/question'
import { PathDialog } from '@/agent-stage/components/path-dialog'
import { CompletionPicker } from '@/agent-stage/components/completion'
import { WorktreeMode } from '@/agent-stage/components/worktree-mode'
import { WorktreeChip } from '@/worktrees/components/chip'
import { WorktreePicker } from '@/worktrees/components/picker'
import { WorktreeManager } from '@/worktrees/components/manager'
import { ModelPicker } from '@/agent-models/components/picker'
import {
  appendAttachment,
  attachmentFromBytes,
  readAttachment,
} from '@/agent-stage/state/attachments'
import { transcriptMarkdown } from '@/agent-stage/utils/timeline'
import { expandedPrompt } from '@/agent-stage/utils/prompt'
import { queuePrompt } from '@/agent-stage/state/inbox'
import { draftKey } from '@/agent-stage/state/drafts'
import { LoadingState } from '@/components/loading-state'
import { TerminalView } from '@/terminal/components/view'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { useCommands } from '@/commands/hooks/use-commands'
import { useHostActions } from '@/host/hooks/use-host-actions'
import { useSettingValue } from '@/settings/hooks/use-setting-value'
import { externalEditorExecutable } from '@/host/external-editor'
import type { Theme } from '@/theme/utils/theme'
import { connectionFailure } from '@/connection/utils/failure'
import { useAgentNavigation } from '@/navigation/hooks/use-agent-navigation'

type Modal = { readonly key: string } & (
  | { readonly kind: 'attachment' }
  | { readonly kind: 'export' }
  | { readonly kind: 'inbox' }
  | { readonly kind: 'changes'; readonly revert: boolean }
  | { readonly kind: 'completion'; readonly text: string }
  | { readonly kind: 'worktree-mode' | 'checkout' | 'worktrees' }
)
export function AgentStage({
  session,
  ready,
  theme,
  target,
  onSelect,
  enabled,
}: {
  readonly session: SettingsSession
  readonly ready: Extract<SessionState, { kind: 'ready' }>
  readonly theme: Theme
  readonly target: StageTarget
  readonly onSelect: (target: StageTarget) => void
  readonly enabled: boolean
}) {
  const state = useStage({ ready, target, onSelect })
  const navigation = useAgentNavigation()
  const { focus } = useCommands()
  const focusSnapshot = useSyncExternalStore(focus.subscribe, focus.getSnapshot)
  const overlayFocused = focusSnapshot.current?.capabilities.overlay === true
  const host = useHostActions()
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()
  const editor = useSettingValue(ready.owner, 'editor.externalEditor')
  const [providers, setProviders] = useState<readonly ProviderSnapshot[]>([])
  const [modal, setModal] = useState<Modal | null>(null)
  const [responding, setResponding] = useState<string | null>(null)
  const [presentedRequest, setPresentedRequest] = useState<string | null>(null)
  const lastTyped = useRef(0)
  const pendingSend = useRef(false)
  const focusedDraft = useRef<string | null>(null)
  const requestWasShown = useRef(false)
  const restoreRequestFocus = useRef(false)
  const activeModal = modal?.key === state.key ? modal : null
  const active = enabled && activeModal === null && target.kind !== 'terminal'
  const approvals = derivePendingApprovals(state.conversation?.activities ?? [])
  const questions = derivePendingUserInputs(state.conversation?.activities ?? [])
  const approval = approvals[0]
  const question = approval ? undefined : questions[0]
  const pendingId = approval?.requestId ?? question?.requestId
  const requestWidget = approval ? 'agent-approval' : 'agent-question'
  const inputAvailable = active && ready.connection.kind === 'live'
  const showRequest = pendingId !== undefined && presentedRequest === pendingId
  useEffect(() => {
    if (requestWasShown.current && !showRequest) {
      const snapshot = focus.getSnapshot()
      const owner = snapshot.current?.capabilities.overlay
        ? snapshot.lastCommandTarget
        : snapshot.current
      restoreRequestFocus.current =
        !owner || owner.widgetId === 'agent-approval' || owner.widgetId === 'agent-question'
    }
    requestWasShown.current = showRequest
    if (!active || showRequest || overlayFocused) return
    if (focusedDraft.current === state.key && !restoreRequestFocus.current) return
    const timer = setTimeout(() => {
      focusedDraft.current = state.key
      restoreRequestFocus.current = false
      focus.request({ kind: 'match', matches: (item) => item.widgetId === 'agent-composer' })
    }, 0)
    return () => clearTimeout(timer)
  }, [state.key, active, showRequest, overlayFocused, focus])
  useEffect(() => {
    if (!pendingId || !active) return
    const wait = () => {
      if (Date.now() - lastTyped.current < 800) {
        timer = setTimeout(wait, 200)
        return
      }
      setPresentedRequest(pendingId)
      timer = setTimeout(
        () =>
          focus.request({
            kind: 'match',
            matches: (item) => item.widgetId === requestWidget,
          }),
        0,
      )
    }
    let timer = setTimeout(wait, 800)
    return () => clearTimeout(timer)
  }, [pendingId, active, requestWidget, focus])
  function close() {
    setModal(null)
    focus.request({ kind: 'match', matches: (item) => item.widgetId === 'agent-composer' })
  }
  async function respond(command: Parameters<typeof state.run>[0], requestId: string) {
    if (pendingSend.current) return
    pendingSend.current = true
    setResponding(requestId)
    try {
      if (!(await state.run(command))) setResponding(null)
    } finally {
      pendingSend.current = false
    }
  }
  async function attachFile(filename: string) {
    const key = state.key
    try {
      const attachment = await readAttachment(filename, state.drafts.read(key).attachments)
      const current = state.drafts.read(key)
      state.drafts.update(key, { attachments: appendAttachment(current.attachments, attachment) })
    } catch (failure) {
      state.setError(connectionFailure(failure).message)
    }
  }
  useCommandHandlers(
    {
      'chat.chooseWorktreeMode': {
        disabledReason: () =>
          target.kind !== 'draft' ? 'A session keeps its original checkout.' : null,
        run: () => setModal({ kind: 'worktree-mode', key: state.key }),
      },
      'chat.chooseCheckout': {
        disabledReason: () =>
          target.kind !== 'draft' ? 'Start a new session to choose another checkout.' : null,
        run: () => setModal({ kind: 'checkout', key: state.key }),
      },
      'chat.stop': {
        disabledReason: () => (state.busy ? null : 'No turn is running.'),
        run: async () => {
          if (state.conversation)
            await state.run(createSessionInterruptCommand({ sessionId: state.conversation.id }))
        },
      },
      'chat.attachFiles': { run: () => setModal({ kind: 'attachment', key: state.key }) },
      'chat.pasteImage': {
        disabledReason: () =>
          host.readClipboardImage ? null : 'Clipboard images require an interactive host.',
        run: async () => {
          const image = await host.readClipboardImage?.(session.signal)
          if (!image) return
          const current = state.drafts.read(state.key)
          const attachment = attachmentFromBytes(
            image.bytes,
            'clipboard-image',
            current.attachments,
          )
          state.drafts.update(state.key, {
            attachments: appendAttachment(current.attachments, attachment),
          })
        },
      },
      'chat.clearAttachments': { run: () => state.drafts.update(state.key, { attachments: [] }) },
      'chat.stashPrompt': { run: () => state.drafts.stash(state.key) },
      'chat.popStash': { run: () => state.drafts.pop(state.key) },
      'chat.previousPrompt': { run: () => state.drafts.history(state.key, -1) },
      'chat.nextPrompt': { run: () => state.drafts.history(state.key, 1) },
      'chat.openPromptInbox': { run: () => setModal({ kind: 'inbox', key: state.key }) },
      'chat.toggleInteractionMode': {
        run: () =>
          state.drafts.update(state.key, {
            interactionMode: state.draft.interactionMode === 'plan' ? 'default' : 'plan',
          }),
      },
      'chat.toggleRuntimeMode': {
        run: () =>
          state.drafts.update(state.key, {
            runtimeMode: nextRuntimeMode(
              state.draft.runtimeMode,
              providers.find(
                (provider) =>
                  provider.providerInstanceId ===
                  (state.draft.modelSelection ?? state.conversation?.modelSelection)
                    ?.providerInstanceId,
              )?.runtimeModes ?? [],
            ),
          }),
      },
      'chat.showChangedFiles': {
        disabledReason: () => (state.conversation ? null : 'Open a conversation first.'),
        run: () => setModal({ kind: 'changes', key: state.key, revert: false }),
      },
      'chat.revertCheckpoint': {
        disabledReason: () =>
          state.conversation && !state.busy ? null : 'Open a settled conversation first.',
        run: () => setModal({ kind: 'changes', key: state.key, revert: true }),
      },
      'chat.exportTranscript': {
        disabledReason: () => (state.conversation ? null : 'Open a conversation to export it.'),
        run: () => setModal({ kind: 'export', key: state.key }),
      },
      'chat.implementPlan': {
        disabledReason: () => (state.plan ? null : 'There is no unfinished plan.'),
        run: async () => {
          await state.send(undefined, 'current')
        },
      },
      'chat.implementPlanInNewSession': {
        disabledReason: () => (state.plan ? null : 'There is no unfinished plan.'),
        run: async () => {
          await state.send(undefined, 'new')
        },
      },
      'chat.resumeInTerminal': {
        disabledReason: () => {
          if (!state.conversation) return 'Open a conversation first.'
          const provider = providers.find(
            (item) =>
              item.providerInstanceId === state.conversation?.modelSelection.providerInstanceId,
          )
          return provider?.driverKind === 'claude'
            ? null
            : 'Terminal resume is available for Claude sessions.'
        },
        run: () => {
          if (state.conversation && inputAvailable)
            onSelect({
              kind: 'terminal',
              face: 'agent',
              sessionId: state.conversation.id,
              worktreeId: state.conversation.worktreeId,
              terminalId: `agent:${state.conversation.id}`,
            })
        },
      },
      'chat.openTerminal': {
        run: () => {
          if (state.worktree)
            onSelect({
              kind: 'terminal',
              face: 'shell',
              sessionId: state.conversation?.id ?? null,
              worktreeId: state.worktree.id,
              terminalId: `chat-terminal:${state.conversation?.id ?? state.worktree.id}`,
            })
        },
      },
      'chat.editPrompt': {
        disabledReason: () =>
          host.editText ? null : 'External editing needs an interactive terminal.',
        run: async () => {
          if (!host.editText) return
          const text = await host.editText({
            text: expandedPrompt({ ...state.drafts.read(state.key), terminalContexts: [] }),
            executable: externalEditorExecutable(editor),
            signal: session.signal,
            filename: 'prompt.md',
          })
          state.drafts.update(state.key, { text, elements: [] })
        },
      },
    },
    active,
  )
  if (target.kind === 'terminal')
    return (
      <TerminalView
        session={session}
        ready={ready}
        theme={theme}
        enabled={enabled}
        worktreeId={target.worktreeId}
        terminalId={target.terminalId}
        agentSessionId={target.face === 'agent' ? target.sessionId : undefined}
        onAskAgent={(context) => {
          queuePrompt(ready.storage, target.worktreeId, context)
          onSelect(
            target.sessionId
              ? { kind: 'conversation', sessionId: target.sessionId }
              : { kind: 'draft', worktreeId: target.worktreeId },
          )
        }}
        onClose={() =>
          onSelect(
            target.sessionId
              ? { kind: 'conversation', sessionId: target.sessionId }
              : { kind: 'draft', worktreeId: target.worktreeId },
          )
        }
      />
    )
  const conversation = state.conversation
  const usage = contextUsageForActivities(conversation?.activities ?? [])
  const selectedModel =
    state.draft.modelSelection ??
    conversation?.modelSelection ??
    state.project?.defaultModelSelection ??
    null
  return (
    <box
      flexDirection='column'
      flexGrow={1}
      minHeight={0}
      minWidth={0}
      backgroundColor={theme.background}
    >
      <box flexDirection='column' paddingX={1} paddingBottom={height < 20 ? 0 : 1} flexShrink={0}>
        <text fg={theme.foreground} height={1}>
          <strong>{conversation?.title ?? 'New session'}</strong>
        </text>
        <box flexDirection='row' gap={1} height={1}>
          <text fg={theme.mutedForeground}>{state.project?.title ?? 'Project'}</text>
          {state.worktree && state.project && (
            <box
              onMouseDown={() => {
                if (active) setModal({ kind: 'worktrees', key: state.key })
              }}
            >
              <WorktreeChip
                worktree={state.worktree}
                repositoryKind={state.project.repositoryKind}
                theme={theme}
              />
            </box>
          )}
        </box>
      </box>
      {usage && (
        <text
          fg={theme.mutedForeground}
        >{`Context ${usage.ratio === null ? formatContextTokens(usage.usedTokens) : `${Math.round(usage.ratio * 100)}%`} · ${formatContextTokens(usage.usedTokens)} tokens`}</text>
      )}
      {conversation?.runtime?.lastError && (
        <text fg={theme.destructive}>{conversation.runtime.lastError}</text>
      )}
      {state.snapshot.detailLoading && !conversation?.detailSynced && (
        <LoadingState theme={theme} label='Opening conversation…' />
      )}
      {conversation?.detailSynced && (
        <Timeline
          key={conversation.id}
          conversation={conversation}
          theme={theme}
          enabled={active}
          busy={state.busy}
          loadingEarlier={state.snapshot.loadingEarlier}
          hasEarlier={state.snapshot.projection.sessionHasEarlierById[conversation.id] ?? true}
          loadEarlier={() => ready.chat.loadEarlier()}
        />
      )}
      {!conversation && !state.snapshot.detailLoading && (
        <box
          flexGrow={1}
          minHeight={0}
          paddingX={2}
          justifyContent='center'
          flexDirection='column'
          gap={height < 20 ? 0 : 1}
          overflow='hidden'
        >
          <text fg={theme.primary}>
            <strong>Start a conversation</strong>
          </text>
          {height >= 20 && (
            <text fg={theme.mutedForeground}>
              Build something. Ask a question. Work through an idea.
            </text>
          )}
        </box>
      )}
      {(state.error ?? state.snapshot.error) && (
        <text fg={theme.destructive}>{state.error ?? state.snapshot.error}</text>
      )}
      {target.kind === 'draft' && (
        <box flexDirection='row' gap={2} paddingX={1} flexShrink={0}>
          <text
            fg={theme.primary}
            onMouseDown={() => {
              if (active) setModal({ kind: 'worktree-mode', key: state.key })
            }}
          >
            {state.draft.worktreeMode === 'new' ? 'New worktree' : 'Send to current branch'} ▾
          </text>
          <text
            fg={theme.mutedForeground}
            onMouseDown={() => {
              if (active) setModal({ kind: 'checkout', key: state.key })
            }}
          >
            Choose checkout
          </text>
        </box>
      )}
      {state.sendDisabledReason && <text fg={theme.warning}>{state.sendDisabledReason}</text>}
      {state.plan && (
        <text
          fg={theme.info}
          onMouseDown={() => {
            if (inputAvailable && !state.submitting) void state.send(undefined, 'current')
          }}
        >
          Plan ready · F1 → Implement plan, or type feedback to refine it
        </text>
      )}
      {showRequest && approval && conversation && (
        <Approval
          key={approval.requestId}
          request={approval}
          theme={theme}
          enabled={inputAvailable}
          busy={responding === approval.requestId}
          onRespond={(decision) => {
            void respond(
              createApprovalRespondCommand({
                sessionId: conversation.id,
                requestId: approval.requestId,
                decision,
              }),
              approval.requestId,
            )
          }}
        />
      )}
      {showRequest && question && conversation && (
        <Question
          key={question.requestId}
          request={question}
          theme={theme}
          enabled={inputAvailable}
          busy={responding === question.requestId}
          onRespond={(answers) => {
            void respond(
              createUserInputRespondCommand({
                sessionId: conversation.id,
                requestId: question.requestId,
                answers,
              }),
              question.requestId,
            )
          }}
        />
      )}
      {pendingId && !showRequest && (
        <text fg={theme.warning}>
          The agent needs your answer. Pause typing to review the request.
        </text>
      )}
      {!showRequest && (
        <Composer
          key={state.key}
          draft={state.draft}
          planReady={state.plan !== null}
          theme={theme}
          enabled={active}
          submitting={state.submitting}
          busy={
            state.busy ||
            !!state.sendDisabledReason ||
            state.snapshot.detailLoading ||
            !!pendingId ||
            ready.connection.kind !== 'live'
          }
          onChange={(text, elements) => state.drafts.update(state.key, { text, elements })}
          onSubmit={(text) => {
            void state.send(text)
          }}
          onComplete={(text) => setModal({ kind: 'completion', key: state.key, text })}
          onTyped={() => {
            lastTyped.current = Date.now()
          }}
          onPasteFile={(filename) => {
            void attachFile(filename)
          }}
        />
      )}
      <box
        flexDirection={width < 70 ? 'column' : 'row'}
        justifyContent='space-between'
        backgroundColor={theme.card}
        paddingX={2}
        paddingBottom={height < 20 ? 0 : 1}
        flexShrink={0}
        minWidth={0}
      >
        <text fg={theme.mutedForeground} height={1}>
          {`${state.draft.interactionMode === 'plan' ? 'Plan' : 'Build'} · ${state.draft.runtimeMode}${pendingId ? ' · Waiting for your answer' : ''}`}
        </text>
        <ModelPicker
          onCatalog={setProviders}
          session={session}
          ready={ready}
          value={selectedModel}
          onSelect={(modelSelection) => state.drafts.update(state.key, { modelSelection })}
          theme={theme}
          enabled={active}
        />
      </box>
      {activeModal?.kind === 'changes' && conversation && (
        <ChangedFiles
          conversation={conversation}
          theme={theme}
          run={state.run}
          revert={activeModal.revert}
          onClose={close}
        />
      )}
      {activeModal?.kind === 'inbox' && (
        <PromptInbox
          draft={state.draft}
          theme={theme}
          onChange={(change) => state.drafts.update(activeModal.key, change)}
          onClose={close}
        />
      )}
      {activeModal?.kind === 'attachment' && (
        <PathDialog
          title='Attach image · local file path'
          theme={theme}
          onClose={close}
          onSubmit={async (filename) => {
            const current = state.drafts.read(activeModal.key)
            const attachment = await readAttachment(filename, current.attachments)
            state.drafts.update(activeModal.key, {
              attachments: appendAttachment(
                state.drafts.read(activeModal.key).attachments,
                attachment,
              ),
            })
          }}
        />
      )}
      {activeModal?.kind === 'completion' && state.worktree && (
        <CompletionPicker
          session={session}
          text={activeModal.text}
          cwd={state.worktree.canonicalPath}
          selection={selectedModel}
          theme={theme}
          onClose={close}
          onSelect={(text) => state.drafts.update(activeModal.key, { text })}
        />
      )}
      {activeModal?.kind === 'worktree-mode' && (
        <WorktreeMode
          value={state.draft.worktreeMode}
          newWorktreeReason={state.worktreeModeReason('new')}
          theme={theme}
          onSelect={(mode) => {
            if (state.setWorktreeMode(mode)) close()
          }}
          onClose={close}
        />
      )}
      {activeModal?.kind === 'checkout' && state.worktree && state.project && (
        <WorktreePicker
          worktrees={Object.values(state.snapshot.projection.worktreeById)}
          project={state.project}
          value={state.worktree.id}
          theme={theme}
          onSelect={(worktreeId) => {
            close()
            onSelect({ kind: 'draft', worktreeId })
          }}
          onClose={close}
        />
      )}
      {activeModal?.kind === 'worktrees' && state.worktree && state.project && (
        <WorktreeManager
          key={state.project.id}
          session={session}
          chat={ready.chat}
          project={state.project}
          currentWorktreeId={state.worktree.id}
          theme={theme}
          onOpenWorkbench={navigation.openWorkbench}
          onSelectWorktree={(worktreeId) => {
            state.drafts.update(draftKey({ kind: 'draft', worktreeId }), {
              worktreeMode: 'current',
            })
            close()
            onSelect({ kind: 'draft', worktreeId })
          }}
          onClose={close}
        />
      )}
      {activeModal?.kind === 'export' && conversation && (
        <PathDialog
          title='Export transcript · local path or clipboard'
          theme={theme}
          initial={`/work/tmp/platform-${conversation.id}.md`}
          onClose={close}
          onSubmit={async (filename) => {
            const transcript = await ready.chat.readTranscript(conversation.id)
            const markdown = transcriptMarkdown(transcript)
            if (filename === 'clipboard') {
              renderer.copyToClipboardOSC52(markdown)
              return
            }
            await writeFile(filename, markdown, { flag: 'wx', mode: 0o600 })
          }}
        />
      )}
    </box>
  )
}
