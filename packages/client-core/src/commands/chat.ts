import { defineMetadata } from './metadata'
import type { KeyChord } from '@singapor/core/keymap'

function chat<const Id extends string>(id: Id, title: string, key?: KeyChord[0]) {
  const chord: KeyChord = ['Control+K', key ?? 'C']
  return defineMetadata({
    id,
    title,
    category: 'Chat',
    execution: 'async',
    target: 'workspace',
    undoCategory: 'workspace-operation',
    when: ['chatMode'],
    keys: key ? [{ chord, platforms: ['tui'] }] : [],
  })
}

function rail<const Id extends string>(id: Id, title: string, key: KeyChord[0]) {
  const chord: KeyChord = [key]
  return defineMetadata({ ...chat(id, title), keys: [{ chord, platforms: ['tui'], pane: 'chat' }] })
}

export const chatCommandMetadata = {
  'chat.undoPrompt': chat('chat.undoPrompt', 'Undo prompt edit'),
  'chat.redoPrompt': chat('chat.redoPrompt', 'Redo prompt edit'),
  'chat.previousPrompt': chat('chat.previousPrompt', 'Previous prompt'),
  'chat.nextPrompt': chat('chat.nextPrompt', 'Next prompt'),
  'chat.openPromptInbox': chat('chat.openPromptInbox', 'Open prompt inbox'),
  'chat.pasteImage': chat('chat.pasteImage', 'Paste clipboard image'),
  'chat.focusInput': chat('chat.focusInput', 'Focus prompt', 'C'),
  'chat.sendMessage': chat('chat.sendMessage', 'Send prompt'),
  'chat.stop': chat('chat.stop', 'Stop response'),
  'chat.exportTranscript': chat('chat.exportTranscript', 'Export transcript'),
  'chat.stashPrompt': chat('chat.stashPrompt', 'Stash prompt'),
  'chat.popStash': chat('chat.popStash', 'Restore stashed prompt'),
  'chat.attachFiles': chat('chat.attachFiles', 'Attach files'),
  'chat.openModelPicker': chat('chat.openModelPicker', 'Choose model', 'M'),
  'chat.chooseWorktreeMode': chat('chat.chooseWorktreeMode', 'Choose session worktree'),
  'chat.chooseCheckout': chat('chat.chooseCheckout', 'Choose existing checkout'),
  'chat.manageWorktrees': chat('chat.manageWorktrees', 'Manage project worktrees'),
  'workspace.newIsolatedSession': chat(
    'workspace.newIsolatedSession',
    'New session in a new worktree',
  ),
  'chat.toggleInteractionMode': chat('chat.toggleInteractionMode', 'Toggle plan mode'),
  'chat.toggleRuntimeMode': chat('chat.toggleRuntimeMode', 'Change access mode'),
  'chat.loadEarlier': chat('chat.loadEarlier', 'Load earlier messages'),
  'chat.jumpToLatest': chat('chat.jumpToLatest', 'Jump to latest message'),
  'chat.resumeInTerminal': chat('chat.resumeInTerminal', 'Resume Claude in terminal'),
  'chat.openTerminal': chat('chat.openTerminal', 'Open session terminal'),
  'chat.editPrompt': chat('chat.editPrompt', 'Edit prompt externally'),
  'chat.completePrompt': chat('chat.completePrompt', 'Complete prompt token'),
  'chat.clearAttachments': chat('chat.clearAttachments', 'Clear prompt attachments'),
  'chat.implementPlan': chat('chat.implementPlan', 'Implement proposed plan'),
  'chat.implementPlanInNewSession': chat(
    'chat.implementPlanInNewSession',
    'Implement plan in a new session',
  ),
  'agent.railNext': rail('agent.railNext', 'Next rail row', 'J'),
  'agent.railPrevious': rail('agent.railPrevious', 'Previous rail row', 'K'),
  'agent.railOpen': chat('agent.railOpen', 'Open selected session'),
  'agent.railFilter': rail('agent.railFilter', 'Filter sessions', '/'),
  'agent.railMenu': rail('agent.railMenu', 'Session actions', 'Shift+F10'),
  'agent.addProject': chat('agent.addProject', 'Add project'),
  'agent.rename': chat('agent.rename', 'Rename selected item'),
  'agent.archive': chat('agent.archive', 'Archive selected sessions'),
  'agent.delete': chat('agent.delete', 'Delete selected item'),
  'agent.toggleArchived': chat('agent.toggleArchived', 'Show archived sessions'),
  'agent.scopeProject': chat('agent.scopeProject', 'Filter to selected project'),
  'agent.clearScope': chat('agent.clearScope', 'Show all projects'),
  'agent.mark': rail('agent.mark', 'Mark selected session', 'M'),
  'agent.markRange': rail('agent.markRange', 'Mark session range', 'Shift+M'),
  'agent.selectAll': chat('agent.selectAll', 'Mark all sessions'),
  'agent.clearMarks': chat('agent.clearMarks', 'Clear marked sessions'),
  'agent.moveUp': chat('agent.moveUp', 'Move selected item up'),
  'agent.moveDown': chat('agent.moveDown', 'Move selected item down'),
  'agent.collapseProject': chat('agent.collapseProject', 'Collapse selected project'),
  'agent.openWorkbench': chat('agent.openWorkbench', 'Open selected workbench'),
  'agent.stopSession': chat('agent.stopSession', 'Stop selected session'),
  'chat.toggleActivities': chat('chat.toggleActivities', 'Show or hide activity'),
  'chat.nextTimelinePage': chat('chat.nextTimelinePage', 'Next transcript page'),
  'chat.previousTimelinePage': chat('chat.previousTimelinePage', 'Previous transcript page'),
  'chat.showChangedFiles': chat('chat.showChangedFiles', 'Show changed files'),
  'chat.revertCheckpoint': chat('chat.revertCheckpoint', 'Revert to checkpoint'),
  'chat.focusTimeline': chat('chat.focusTimeline', 'Focus transcript'),
}
