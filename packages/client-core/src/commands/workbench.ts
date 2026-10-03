import { defineMetadata } from './metadata'
import type { FocusArea } from './focus'

function workbench<const Id extends string>(
  id: Id,
  title: string,
  description: string,
  pane?: FocusArea,
) {
  return defineMetadata({
    id,
    title,
    description,
    category: pane ?? 'Workspace',
    execution: 'async',
    target: 'workspace',
    undoCategory: 'workspace-operation',
    when: [],
  })
}

export const workbenchCommandMetadata = {
  'terminal.askAgent': workbench(
    'terminal.askAgent',
    'Ask agent about terminal selection',
    'Attach selected terminal text to the checkout prompt.',
  ),
  'terminal.reconnect': workbench(
    'terminal.reconnect',
    'Reconnect terminal',
    'Reconnect to the existing terminal and retry pending session synchronization.',
  ),
  'git.generateCommitMessage': workbench(
    'git.generateCommitMessage',
    'Generate commit message',
    'Generate a message for the staged changes.',
  ),
  'git.createPullRequest': workbench(
    'git.createPullRequest',
    'Create draft pull request',
    'Open a draft pull request for the current branch.',
  ),
  'search.replace': workbench(
    'search.replace',
    'Replace workspace matches',
    'Preview and apply a workspace replacement.',
  ),
  'git.discard': workbench(
    'git.discard',
    'Discard change',
    'Confirm and discard the selected change.',
  ),
  'git.fetch': workbench('git.fetch', 'Fetch', 'Fetch remote repository changes.'),
  'git.pull': workbench('git.pull', 'Pull', 'Pull changes into the current branch.'),
  'git.push': workbench('git.push', 'Push', 'Push the current branch to its remote.'),
  'search.toggleRegex': workbench(
    'search.toggleRegex',
    'Toggle regular expressions',
    'Search using a regular expression.',
  ),
  'search.toggleCase': workbench(
    'search.toggleCase',
    'Toggle case-sensitive search',
    'Match the query with exact letter case.',
  ),
  'search.toggleWholeWord': workbench(
    'search.toggleWholeWord',
    'Toggle whole-word search',
    'Match whole words in workspace files.',
  ),
  'workspace.openWorkbench': workbench(
    'workspace.openWorkbench',
    'Open workbench',
    'Open the selected folder as a workbench.',
  ),
  'workspace.changeProject': workbench(
    'workspace.changeProject',
    'Open folder in workbench',
    'Choose a server folder to open.',
  ),
  'workspace.showProblems': workbench(
    'workspace.showProblems',
    'Show problems',
    'Inspect diagnostics for the open file.',
  ),
  'workspace.showLogs': workbench(
    'workspace.showLogs',
    'Show logs',
    'Inspect and follow structured server logs.',
  ),
  'workspace.toggleSidebar': workbench(
    'workspace.toggleSidebar',
    'Toggle file tree',
    'Show or hide the workbench file tree.',
  ),
  'workspace.goToLine': workbench(
    'workspace.goToLine',
    'Go to line',
    'Navigate to a line in the file viewer.',
    'editor',
  ),
  'workspace.editFile': workbench(
    'workspace.editFile',
    'Edit file',
    'Edit in the built-in editor and commit against the loaded snapshot.',
    'editor',
  ),
  'terminal.new': workbench(
    'terminal.new',
    'New terminal',
    'Create a shell in this worktree.',
    'terminal',
  ),
  'terminal.close': workbench(
    'terminal.close',
    'Close terminal',
    'Terminate the selected shell.',
    'terminal',
  ),
  'terminal.next': workbench(
    'terminal.next',
    'Next terminal',
    'Select the next shell.',
    'terminal',
  ),
  'terminal.previous': workbench(
    'terminal.previous',
    'Previous terminal',
    'Select the previous shell.',
    'terminal',
  ),
  'terminal.attach': workbench(
    'terminal.attach',
    'Attach terminal',
    'Hand the host terminal to this shell until detached.',
    'terminal',
  ),
  'terminal.clear': workbench(
    'terminal.clear',
    'Clear terminal',
    'Clear the terminal viewport.',
    'terminal',
  ),
  'terminal.copy': workbench(
    'terminal.copy',
    'Copy terminal',
    'Copy terminal text through the host clipboard.',
    'terminal',
  ),
  'terminal.paste': workbench(
    'terminal.paste',
    'Paste into terminal',
    'Paste clipboard text into the shell.',
    'terminal',
  ),
  'git.next': workbench('git.next', 'Next changed file', 'Select the next Git change.', 'git'),
  'git.previous': workbench(
    'git.previous',
    'Previous changed file',
    'Select the previous Git change.',
    'git',
  ),
  'git.open': workbench(
    'git.open',
    'Open changed file',
    'Open the selected change in the file viewer.',
    'git',
  ),
  'git.stage': workbench('git.stage', 'Stage change', 'Stage the selected file.', 'git'),
  'git.unstage': workbench('git.unstage', 'Unstage change', 'Unstage the selected file.', 'git'),
  'git.commit': workbench(
    'git.commit',
    'Commit staged changes',
    'Create a commit from staged changes.',
    'git',
  ),
  'git.refresh': workbench(
    'git.refresh',
    'Refresh Git',
    'Refresh repository status and diff.',
    'git',
  ),
  'git.toggleDiff': workbench(
    'git.toggleDiff',
    'Toggle diff layout',
    'Switch between split and stacked diff rows.',
    'git',
  ),
  'git.expandDiff': workbench(
    'git.expandDiff',
    'Expand diff context',
    'Reveal additional context around a diff hunk.',
    'git',
  ),
  'search.next': workbench(
    'search.next',
    'Next search result',
    'Select the next workspace match.',
    'search',
  ),
  'search.previous': workbench(
    'search.previous',
    'Previous search result',
    'Select the previous workspace match.',
    'search',
  ),
  'search.open': workbench(
    'search.open',
    'Open search result',
    'Open the selected match in the file viewer.',
    'search',
  ),
  'search.refresh': workbench(
    'search.refresh',
    'Run search',
    'Search the workspace with the current query.',
    'search',
  ),
  'logs.next': workbench('logs.next', 'Next log', 'Select the next log event.', 'logs'),
  'logs.previous': workbench(
    'logs.previous',
    'Previous log',
    'Select the previous log event.',
    'logs',
  ),
  'logs.open': workbench(
    'logs.open',
    'Inspect log',
    'Show the selected structured log event.',
    'logs',
  ),
  'logs.refresh': workbench(
    'logs.refresh',
    'Refresh logs',
    'Reload structured log events.',
    'logs',
  ),
  'logs.pause': workbench(
    'logs.pause',
    'Pause or resume logs',
    'Pause or resume the live log stream.',
    'logs',
  ),
  'fileTree.newFile': workbench(
    'fileTree.newFile',
    'New file',
    'Create a file in the selected folder.',
    'file-tree',
  ),
  'fileTree.newFolder': workbench(
    'fileTree.newFolder',
    'New folder',
    'Create a folder in the selected folder.',
    'file-tree',
  ),
  'fileTree.rename': workbench(
    'fileTree.rename',
    'Rename file or folder',
    'Rename the selected entry.',
    'file-tree',
  ),
  'fileTree.delete': workbench(
    'fileTree.delete',
    'Delete file or folder',
    'Confirm and delete the selected entry.',
    'file-tree',
  ),
  'fileTree.refresh': workbench(
    'fileTree.refresh',
    'Refresh files',
    'Refresh the visible file tree.',
    'file-tree',
  ),
}
