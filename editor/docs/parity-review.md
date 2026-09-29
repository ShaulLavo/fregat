# Code review — `parity/monaco-codemirror`

19 commits, 269 files, +45,230/-3,080, reviewed against `main`.

Seven area reviewers each returned findings; every finding was then handed to an independent agent
instructed to **refute** it and to default to refuted when uncertain. 35 raised, 32 survived, 3 refuted.
A 3/35 refutation rate is low enough to treat with suspicion, so a sample was re-verified by hand;
those are marked **[verified]** below. The rest carry the reviewer's own reproduction.

Style, naming and 'could be extracted' were out of scope and are not listed.

---

## Editing semantics

### [BLOCKER] `packages/editor/src/editor/inputSelectionController.ts:973`

**No delete or line-break path advances the SnippetSession onto the snapshot it produced, so the first Backspace or Enter inside a snippet silently ends tab-stop navigation and Tab reverts to inserting an indent.**

*Failure:* 

*Evidence:*

```
happy-dom vitest probe driving the real Editor (copy of test/snippets.test.ts harness), run as `npx vitest run --project dom`. Output:
  control text "log(ab, level)" / control selected "level"   <- no backspace: works
  after backspace "log(a, level)"
  claim1 backspace text "log(a\t, level)" / claim1 backspace selected ""
  after enter "log(a\n    , level)"
  claim1 enter text "log(a\n    \t, level)" / claim1 enter selected ""
Second probe, real key events and mirrored snippets:
  1e after backspace key "log(a, level)" ; 1e tab "log(a\t, level)" ""   (KeyboardEvent keydown Backspace, not dispatchCommand)
  1c after backspace "let u = u\nbody" ; 1c tab "let u = u\nbody" "body"   (mirrored snippet survives Backspace)
  1d after enter "let us\n = us\nbody" ; 1d tab "let us\n\t = us\nbody" ""   (Enter kills even a mirrored session)
Grep that settles the root cause: `grep -rn "this.snippet\." packages/editor/src` -> advance only at 332, 553, 846, 930.
```

## Inline layer & ghost text

### [BLOCKER] `packages/editor/src/editor/ghostText.ts:199`

**A shown inline suggestion is invalidated only by snapshot identity, never by the caret moving, so Tab pressed elsewhere commits the suggestion at its old offset instead of indenting.**

*Failure:* 

*Evidence:*

```
Scratch vitest (deleted afterwards) at packages/editor/test/zz-review-probe.test.ts, run with `bunx vitest run --project dom --silent=false --reporter=verbose test/zz-review-probe.test.ts` from packages/editor. Document 'con\nzzzz', caret 3, setInlineSuggestion({from:0,to:3,text:'const answer'}) -> true, then a keydown 'ArrowDown' and a keydown 'Tab' on `.editor-virtualized`. Output: `rows with ghost: ["const answer","zzzz"]` / `cursor after ArrowDown: {"row":1,"column":3}` / `rows after caret move: ["const answer","zzzz"]` / `text after Tab: "const answer\nzzzz"` / `cursor after Tab: {"row":0,"column":12}`. A second variant moved the caret backwards instead (ArrowLeft to row 0 column 2, i.e. the run is now drawn behind the caret, the state ghostText.ts:95 exists to forbid): `variant rows: ["const answer"]` / `variant text after Tab: "const answer"` / `variant cursor after Tab: {"row":0,"column":12}` — again a commit, not an indent.
```

## Input pipeline & a11y

### [BLOCKER] `packages/editor/src/editor/inputSelectionController.ts:961`

**Editing and navigation commands are dispatched from the keymap while an IME composition is live, so a keystroke the IME owns edits the document instead.**

*Failure:* 

*Evidence:*

```
Scratch test packages/editor/test (dom project), dispatching a real `KeyboardEvent('keydown',{key:'Backspace',code:'Backspace',bubbles:true,cancelable:true})` with `isComposing` defined true onto `.editor-virtualized-input` between compositionstart/compositionupdate('にほん') on doc 'alpha beta gamma', caret 6:
  [c1] element before composition = "alpha beta gamma" 6
  [c1] defaultPrevented = true
  [c1] doc after Backspace = "alphabeta gamma"
  [c1] element after = "alphabeta gamma" 5
  [c1] doc after commit = "alphaにほんbeta gamma"
ArrowRight variant:
  [c1b] defaultPrevented = true
  [c1b] doc after arrow = "alpha beta gamma"
  [c1b] doc after commit = "alpha bにほんeta gamma"
Also: `grep -rn "isComposing|composi|229|keyCode" node_modules/.bun/@tanstack+hotkeys@0.8.0/node_modules/@tanstack/hotkeys/{src,dist}` -> no matches.
```

## Editor core & contracts

### [MAJOR] `packages/editor/src/editor/keymap.ts:286`

**Ten EditorCommandId values have no EditorCommandPack, so both exported pack-filter helpers (editorKeymapLayersForBindings, filterEditorKeymapLayersByCommandPacks) silently drop any binding for them even when every pack is enabled.**

*Failure:* 

*Evidence:*

```
bun script importing keymap.ts + enumerating the EditorCommandId union from commands.ts: `total ids 122 unclassified 10` -> [jumpToBracket, toggleWordWrap, trimTrailingWhitespace, sortLinesAscending, sortLinesDescending, joinLines, duplicateSelection, transformToUppercase, transformToLowercase, transformToTitlecase]; `editorKeymapLayersForBindings -> []`; `filterEditorKeymapLayersByCommandPacks -> []`. Scratch vitest (dom project, deleted): raw layer `{id:'app',bindings:[{hotkey:{key:'Z',alt:true},command:'editor.action.toggleWordWrap'}]}` -> `raw layer: before false / raw layer: after Alt+Z true`; helper-built -> `helper layers count: 0 / helper layer: before false / helper layer: after Alt+Z false`.
```

### [MAJOR] `packages/editor/src/editor/Editor.ts:2844`

**flushOperation runs the whole listener fan-out before projecting the pass's own edits into the decoration store, so an edit made from a listener is projected first and the outer pass's edits are then applied on top of an already-moved decoration.**

*Failure:* 

*Evidence:*

```
Scratch vitest in packages/editor/test (dom project, modelled on decorationTracking.test.ts, deleted afterwards). Doc 'alpha world gamma', one registered decoration [6,11). CONTROL arm (two top-level passes) vs REENTRANT arm (host onChange inserts '>> ' at 0 on first edit it sees), both then editor.edit({from:8,to:8,text:'XY'}): `CONTROL text: ">> alpha woXYrld gamma" range 9,16 "woXYrld"` / `REENTRANT text: ">> alpha woXYrld gamma" range 11,16 "XYrld"` — identical document, decoration two characters off.
```

### [MAJOR] `packages/editor/src/editor/optionDescriptors.ts:93`

**wordWrap and lineHeight are EditorOptions fields with public runtime setters but have no entry in EDITOR_OPTION_DESCRIPTORS, so the React and Solid bindings apply them only at construction and ignore every later change.**

*Failure:* 

*Evidence:*

```
Scratch vitest in packages/react/test (deleted): mounted useEditor({document, wordWrap:true, lineHeight:20}) via EditorHost, spied setWordWrap/setLineHeight on the live instance, re-rendered with {wordWrap:false, lineHeight:40}. Output: `initial isWordWrapEnabled: true` / `same editor instance: true` / `setWordWrap calls: []` / `setLineHeight calls: []` / `after re-render isWordWrapEnabled: true` / `after imperative setWordWrap(false): false` — the setter works, the binding never calls it.
```

### [MAJOR] `packages/editor/src/editor/commandRouter.ts:45`

**clearSecondarySelections has no keybinding on any platform, and its only keyboard route — Escape falling through closeFind — is nested inside the registeredResult !== null branch, so it is unreachable unless something has registered a closeFind handler.**

*Failure:* 

*Evidence:*

```
Scratch vitest (dom project, deleted): `new Editor(container, {})` with no plugins, session 'abcdef' with two selections, dispatch a real Escape keydown on the editor root -> `selections after Escape (no find plugin): 2`; `dispatchCommand closeFind -> false` / `selections after dispatch closeFind: 2`; `dispatchCommand clearSecondarySelections -> true` / `selections after clearSecondarySelections: 1`. bun script over defaultEditorKeyBindings: `mac/windows/linux has clearSecondarySelections binding? false`, `Escape bound to: ["closeFind"]` on all three; editorKeymapLayersForCommandPacks(['navigation','selection','multi-cursor','text-editing'],'mac') -> `host-pack Escape bindings: []`.
```

## Editing semantics

### [MAJOR] `packages/editor/src/editor/snippetSession.ts:92`

**SnippetSession.move clears the entire session when one stop's anchors no longer resolve, instead of skipping that stop, so replacing a placeholder that contains a nested placeholder makes every later stop unreachable.**

*Failure:* 

*Evidence:*

```
Same happy-dom probe:
  claim2 initial "setTimeout(() => {\n\tbody\n}, delay)"
  claim2 after type "setTimeout(x, delay)"        <- document is correct
  claim2 after tab1 "setTimeout(x\t, delay)" ""   <- literal tab, empty selection
  claim2 after tab2 "setTimeout(x\t\t, delay)" "" <- `delay` never reachable
Code at snippetSession.ts:90-95:
  const range = stop ? resolveRange(snapshot, stop.caret) : null
  if (!range) { this.clear(); return null }
```

## Find, folding & decorations

### [MAJOR] `packages/find/src/plugin.ts:381`

**trackPaintedFindRanges partitions matches against the viewport as it stood when the search ran; nothing re-partitions on scroll, so after a scroll the next keystroke paints every on-screen match at pre-edit offsets, steps the wrong entry in Find Next, and publishes a stale count.**

*Failure:* 

*Evidence:*

```
Scratch probes in packages/find/test built on the editorHost.test.ts pattern (real Editor, 400x 'foo line\n', highlights read back off the highlight registry), scrolled by setting scrollElement.scrollTop and dispatching 'scroll'. Output: `band at search { count: 13, start: 0, end: 116 }` / `band after scroll { count: 25, start: 1314, end: 1538 }` / `painted after scroll: distinct ["foo"] n= 25` / after `editor.edit({from:0,to:0,text:'X'})`: `painted after edit: distinct ["fo"] n= 25`. Caret-in-band variant (setSelection to the first visible row, then type there): `painted after edit: distinct ["foo","Xfo","fo"] n= 25`, `count widget ? of 400`. Navigation: `selection 135 138 "\nfo"` from findNext after the edit. Delete-all after scroll: `count after delete-all ? of 387` on an emptied document. Recovery: `immediately after edit ["fo"]` / `after 600ms ["foo"]`. Probes deleted; `git status --short` empty.
```

## Inline layer & ghost text

### [MAJOR] `packages/editor/src/editor/ghostText.ts:119`

**The per-run `className` M15 added is written onto the segment and read by nothing, so ghost text renders byte-identical to the reader's own text.**

*Failure:* 

*Evidence:*

```
Same scratch vitest. Document 'con', caret 3, setInlineSuggestion({from:0,to:3,text:'const answer'}). Output: `ROW class= editor-virtualized-row editor-virtualized-cursor-line-row editor-inline-ghost-text` / `ROW html= const answer` (one bare text node, no wrapping element) / `ghost-classed nodes: 0 1` — zero `.editor-ghost-text` nodes, the single `.editor-inline-ghost-text` node being the row element itself. The same probe over an inlay hint (className 'editor-inlay-hint', kind 'inlay-hint') gives `hint row html: foo(arg:1)` — also one bare text node, so the dead property is the whole injected-text feature, not ghost text alone. Greps: `grep -rn "className" packages/*/src` shows the three writes and no read; `grep -rn "editor-inline-" packages/editor/src/style.css` -> only `.editor-inline-widget`.
```

### [MAJOR] `packages/editor/src/inlineMap.ts:240`

**normalizeInlineRanges drops a zero-width insertion that shares a start offset with a substitution while keeping one at that substitution's end offset, and GhostTextSession still reports the suggestion as showing and still commits it on Tab.**

*Failure:* 

*Evidence:*

```
Same scratch vitest, with `editor.setInlineReplacementProvider(() => [{id:'open',startIndex:0,endIndex:2,text:'',kind:'md',groupId:'bold'},{id:'close',startIndex:6,endIndex:8,text:'',kind:'md',groupId:'bold'}])` over '**bold** tail'. Caret 6, setInlineSuggestion({from:6,to:6,text:'SUGGEST'}): `claim3 setInlineSuggestion returned: true` / `claim3 rows with suggestion: ["**bold** tail"]` (no SUGGEST anywhere on screen) / then a Tab keydown -> `claim3 text after Tab: "**boldSUGGEST** tail"`. Controls in the same run: caret 5 -> `claim3 control rows (caret 5): ["**bolSUGGESTd** tail"]`, caret 8 -> `claim3 control rows (caret 8): ["**bold**SUGGEST tail"]`, so only the substitution's start offset loses its phantom.
```

### [MAJOR] `packages/editor/src/displayTransforms.ts:400`

**injectedRunCaretColumn is applied to every sourceColumnToInlineColumn call, not just caret mapping, so any decoration/highlight/token range whose end offset is the injected run's point is stretched across the whole run.**

*Failure:* 

*Evidence:*

```
Same scratch vitest with a mocked CSS highlight registry. Ghost case: 'con', caret 3, decoration {start:0,end:3,className:'probe'}. `highlights before: [{"name":"editor-token-0-range-probe-0","ranges":[{"s":0,"e":3,..."con"}]}]`; after setInlineSuggestion({from:0,to:3,text:'const answer'}) -> `highlights after: [...{"s":0,"e":12,"startText":"\"const answer\"","endText":"\"const answer\""}]` — the decoration now paints the entire ghost run. Generalized to the flagship inlay-hint path with no ghost text and the caret at 0: 'foo(1)' with an insertion 'arg:' at offset 4 renders `hint rows: ["foo(arg:1)"]`, and decoration [0,4) reports `{"s":0,"e":8}` (covers 'foo(arg:') while decoration [4,6) reports `{"s":4,"e":10}` (covers 'arg:1)').
```

## Input pipeline & a11y

### [MAJOR] `packages/editor/src/editor/inputSelectionController.ts:1435`

**refreshHiddenInputContent writes input.value and setSelectionRange with no composition guard, so any session change during a live composition destroys the IME's buffer.**

*Failure:* 

*Evidence:*

```
Scratch probe, doc 'alpha beta gamma', caret 6, compositionstart+update('にほん'), element hand-set to 'alpha にほんbeta gamma' sel 9:
  [p] after syncText   element = "alpha にほんbeta gamma" 9 | doc = "alpha beta gamma!"      <- NOT rewritten
  [p] after session.applyEdits element = "alpha にほんbeta gamma" 9 | doc = "alpha beta gamma!"  <- NOT rewritten
  [p] after editor.edit element = "alpha beta gamma!" 6 | doc = "alpha beta gamma!"        <- buffer wiped
  [c2] element after setText = "alpha beta gamma!!" 18                                     <- buffer wiped
  [p] after setSelection element = "alpha beta gamma" 2 ; doc after commit = "alにほんpha beta gamma"  <- commit lands at the moved caret
```

## LSP plugin

### [MAJOR] `packages/lsp-plugin/src/completionController.ts:128`

**A `viewport` or `layout` update arriving while a completion request is in flight cancels it outright and never re-issues it, so the list never appears.**

*Failure:* 

*Evidence:*

```
Scratch test packages/lsp-plugin/test/zzscratch.test.ts (since deleted) using the shared harness test/connectedEditor.ts; `npx vitest run test/zzscratch.test.ts --silent=false --reporter=verbose` printed:
  requests after debounce = 1
  CLAIM1 hidden after scroll-during-flight = true
  CLAIM1 requests total = 1
  CONTROL hidden = false        (identical sequence without editor.scroll(10))
  CLAIM1b requests after scroll-inside-debounce = 0   (type('l'); advance 40ms; scroll(10); advance 200ms -> the request is never sent at all)
Code quoted: completionController.ts:128-131 (`if (kind !== 'content') { if (!this.reanchorSession()) this.hide(); ... }`), :217 (`if (!this.completionSession || !caret) return false`), :446-450 (`cancelCompletionRequest` bumping `completionRequestId`), :349 (`if (requestId !== this.completionRequestId) return`); Editor.ts:2679 and :2810-2831 (revealOffset precedes notifyViewContributions).
```

### [MAJOR] `packages/lsp/src/capabilities.ts:39`

**`textDocument.completion.completionItem.insertReplaceSupport` is never advertised, so no conforming server may send an `InsertReplaceEdit` — M13's insert-vs-replace deliverable and its only test are unreachable from production.**

*Failure:* 

*Evidence:*

```
Scratch test through `connectedEditor`, printing `editor.initializeParams().capabilities.textDocument.completion`:
  CAPS = {"contextSupport":true,"completionItem":{"documentationFormat":["markdown","plaintext"],"labelDetailsSupport":true,"resolveSupport":{"properties":["documentation","detail","additionalTextEdits"]},"snippetSupport":true}}
`grep -rn "insertReplaceSupport" packages examples docs` -> no matches. `grep -rn "capabilities" packages/lsp-plugin/src` -> no matches. Spec text: node_modules/.bun/vscode-languageserver-types@3.18.0/.../main.d.ts:1607-1610. Bundled server: typescriptLsp.worker.ts:660.
```

### [MAJOR] `packages/lsp-plugin/src/completion.ts:227`

**`completionTriggerFromChange` requires a one-character edit, but auto-close writes opener+closer as one two-character edit, so the quote trigger characters never fire a completion request.**

*Failure:* 

*Evidence:*

```
Scratch test packages/editor/test/zzscratch.test.ts (since deleted), real `new Editor(...)`, languageId 'typescript', dispatching InputEvent('beforeinput'):
  CLAIM3 text now = "import fs from \"\""
  CLAIM3 edits = [{"from":15,"to":15,"text":"\"\""}]
  CLAIM3b edits = [{"from":14,"to":14,"text":"."}]     (the dot stays one character)
Feeding those exact shapes to the real function in packages/lsp-plugin:
  CLAIM3 trigger for 2-char edit = null
  CLAIM3 trigger for 1-char edit = {"triggerKind":2,"triggerCharacter":"\""}
```

### [MAJOR] `packages/lsp-plugin/src/formatOnType.ts:229`

**Format-on-type answers a one-row question with a whole-document scan on the keystroke, so a lone closing brace costs roughly ten times any other character and grows with file size.**

*Failure:* 

*Evidence:*

```
Scratch test in packages/editor/test (since deleted), calling the real helper with a repeated 7-line TS block, warm run discarded:
  CLAIM4 chars=21200 elapsed=0.92ms
  CLAIM4 chars=212000 elapsed=7.57ms
  CLAIM4 chars=848000 elapsed=16.32ms
(second run of the same file: 1.21 / 4.75 / 18.71 ms). Code: formatOnType.ts:229-233; reindent.ts:114-127 (`reindentEditsForRanges` -> `documentSelectionEditForCommand`), :83 (`createReindentSource(text, configuration)` before any range narrowing), :128-140 (full row-start loop), :153-196 (`maskLiterals` walking every character); plugin.ts:721 (`formatOnType: options.formatOnType ?? true`).
```

## Rendering & geometry

### [MAJOR] `packages/editor/src/virtualization/virtualizedTextViewHiddenCharacters.ts:314`

**The suspicious-character scan is handed `row.text`, which for a wrapped line is only the wrapped segment, so `isExcusedByItsWord` judges word fragments and flags ordinary non-Latin prose.**

*Failure:* 

*Evidence:*

```
Scratch vitest (dom project) mounting VirtualizedTextView on 'город город город город', characterWidth 8. Logged: `C1 wrap-off row texts: ["город город город город"]` / `C1 wrap-off markers: []`; then with wrap on at 64px viewport: `C1 wrap-on row texts: ["город го","род горо","д город"]` / `C1 wrap-on markers: ["ambiguous" x6]` at offsets 6,7,12,13,14,15. Classifier confirms the mechanism: `ranges(город): []`, `ranges(го): [{0,1,ambiguous},{1,2,ambiguous}]`, `ranges(горо): 4 ranges`, `ranges(род): []`. Realism sweep over 'Хорошо когда сорока сидит на дереве около дороги и смотрит на город который просыпается рано утром': `cols=30 markers=3`, `cols=40 markers=1`, `cols=60 markers=1`, `cols=50/70/80 markers=0`.
```

### [MAJOR] `packages/editor/src/virtualization/virtualizedTextViewGeometry.ts:320`

**`measuredRowWidths` is keyed on `row.element` under `rowGeometryCacheKey`, which identifies nothing about which line the element currently renders, so a recycled row element returns the previous line's measured width.**

*Failure:* 

*Evidence:*

```
Scratch vitest (dom project) with the geometry suite's `stubProportionalLayout`, document of 2 `ééééé` lines + 58 `漢字漢字漢`. One-row viewport: `C2 latin measured width 36.383`, after scroll `C2 same element reused? true`, `C2 cjk text "漢字漢字漢"`, `C2 knownRowContentWidth(cjk) 36.383`, `C2 measureRowContentWidth(cjk) 36.383`, `C2 true cjk width 77.5`, `C2 contentWidth 37`. Repeated with a realistic 20-row viewport: `C2r reused row text "漢字漢字漢" known 36.383 measured 36.383 true 77.5` — same stale answer — but `C2r contentWidth after scroll 78`, i.e. the extent is rescued by the other rows.
```

### [MAJOR] `packages/editor/src/virtualization/virtualizedTextViewGeometry.ts:660`

**`appendCalculatedChunkBoundaries` divides `characterWidth` by the client-rect scale only when `measurement` is non-null (rows longer than KEY_COLUMN_DISTANCE), while `calculatedCellWidth` divides unconditionally, so short calculated rows map offset->x and x->offset in two different spaces.**

*Failure:* 

*Evidence:*

```
Scratch vitest (dom project), `stubProportionalLayout` plus `offsetWidth = 2000` against a 4000px row rect (scale 2), `clearRowGeometryCache` between reads. Short 17-char ASCII row `const value = 42;`: `C3 short col 5 x 36.133 roundTrip 10`, `C3 short col 10 x 72.266 roundTrip 17`. Same stub on `'z'.repeat(700)`: `C3 long col 5 x 18.0665 roundTrip 5`, `C3 long col 10 x 36.133 roundTrip 10`, `C3 long col 400 x 1452.82 roundTrip 400`. Expected scaled cell width 3.6133 = 7.2266/2. Also `grep -rn "transform\|scale\|offsetWidth" packages/editor/test/*.browser.test.ts` returns only unrelated prose.
```

## Editor core & contracts

### [MINOR] `packages/editor/src/public/extensions.ts:39`

**EditorSelectionRangeProvider and EditorSelectionRangeContext are exported from no published entrypoint, so a plugin author cannot name the type of the provider registerSelectionRangeProvider takes.**

*Failure:* 

*Evidence:*

```
Dropped a two-line file into packages/tree-sitter/src importing `type { EditorSelectionRangeProvider } from '@singapore-editor/core/extensions'` and ran `bunx tsgo --noEmit` in that package: `src/zz-scratch-import.ts(1,15): error TS2724: '"@singapore-editor/core/extensions"' has no exported member named 'EditorSelectionRangeProvider'. Did you mean 'EditorSelectionRange'?` (file removed). grep for both names across packages/editor/src/index.ts, editor.ts, internal.ts and public/ returns exit 1.
```

### [MINOR] `packages/editor/src/editor/Editor.ts:1644`

**When a contribution factory throws, the editor unwinds the row-decoration sources it claimed but not the commands or capability features it registered, so those registrations outlive the contribution that owns them and permanently block the ids.**

*Failure:* 

*Evidence:*

```
Scratch vitest in packages/editor/test (dom project, deleted): plugin A's registerCommandContribution factory calls registerCommand('findNext', orphanHandler) then `throw new Error('missing dependency')`; plugin B registers a correct 'findNext' handler. Output: `dispatch findNext -> true` / `orphan handler ran: true | good handler ran: false` — the orphan handler from the dropped contribution survives, runs, and blocked plugin B's contribution (its registerCommand threw 'Editor command already registered: findNext' into the same catch).
```

## Editing semantics

### [MINOR] `packages/editor/src/editor/editActions.ts:850`

**The blank-line guard commentedRows is applied on the line-comment path but missing on the sibling block-comment-per-line path, so toggling comments in a block-only language writes a comment onto empty lines.**

*Failure:* 

*Evidence:*

```
`bun run` on a scratch script calling editActionForCommand('editor.action.commentLine', 'alpha\n\nbeta', [whole-doc selection], { languageId, tabSize: 2 }) and applying the returned edits:
  claim3 markdown "<!-- alpha -->\n<!--  -->\n<!-- beta -->"
  claim3 css "/* alpha */\n/*  */\n/* beta */"
  claim3 html "<!-- alpha -->\n<!--  -->\n<!-- beta -->"
  claim3 typescript "// alpha\n\n// beta"     <- line path correctly skips the blank row
Also ran: whitespace-only row -> "alpha\n   /*  */\nbeta"; round-trip -> "alpha\n\nbeta" CLEAN; toggling a blank-skipped block -> "<!-- <!-- alpha --> -->\n<!--  -->\n<!-- <!-- beta --> -->".
```

### [MINOR] `packages/editor/src/editor/reindent.ts:378`

**indentTextForRange votes for tabs if any single row in the reindented range has a tab in its leading whitespace, so one stray tab rewrites the indentation characters of a whole space-indented file.**

*Failure:* 

*Evidence:*

```
`bun run` on a scratch script calling documentSelectionEditForCommand('editor.action.reindentlines', text, [collapsed caret at 0], { languageId: 'typescript', tabSize: 4 }):
  reviewer's fixture -> edits [{from:15,text:"\t",to:17},{from:29,text:"\t",to:31},{from:40,text:"\t\t",to:41},{from:53,text:"\t",to:55}] (matches their report exactly)
  sharpened: 'function a() {\n    const x = 1\n    if (x) {\n\tconst y = 2\n    }\n    return x\n}' (4-space file, tabSize 4, one tab row)
    -> "function a() {\n\tconst x = 1\n\tif (x) {\n\t\tconst y = 2\n\t}\n\treturn x\n}", edit count 5
  control, same file with that row as spaces -> edits 0, text unchanged
Also: `grep -rn insertSpaces packages/editor/src` returns nothing.
```

### [MINOR] `packages/editor/src/editor/inputSelectionController.ts:383`

**graphemeStartBefore is a third grapheme implementation that segments a fixed 8-code-unit window (the exact defect the widening loop in graphemes.ts exists to prevent) and uses cluster granularity where every other backspace uses previousDeleteBoundary, so a mirrored backspace cuts a cluster in half.**

*Failure:* 

*Evidence:*

```
happy-dom probe on the real Editor, snippet 'let ${1:name} = $1', one deleteBackward:
  claim5 after type "let 👨‍👩‍👧‍👦 = 👨‍👩‍👧‍👦"
  claim5 after backspace "let 👨‍ = 👨‍"  codepoints 6c,65,74,20,1f468,200d,20,3d,20,1f468,200d  <- dangling U+200D in both places
  claim5b (same emoji, no snippet, plain backspace) "let 👨‍👩‍👧"  codepoints 6c,65,74,20,1f468,200d,1f469,200d,1f467
Combining mark, NFD 'café':
  5c after type "let café = café" ; 5c after backspace "let caf = caf" (6c,65,74,20,63,61,66,...) <- base letter eaten too
  5d (no snippet, plain backspace) "let cafe" (…,63,61,66,65)                                  <- only the accent removed
```

## Find, folding & decorations

### [MINOR] `packages/find/src/search.ts:403`

**isLineSafePattern inspects only escapes and character classes, so unrecognized group syntax such as an ES2025 modifier group `(?s:` is judged break-free and routes a newline-matching pattern to the per-line path, reporting no results for text that is plainly there.**

*Failure:* 

*Evidence:*

```
Scratch test calling findMatches directly through findHarness's findTextSource over 'alpha\nbeta\ngamma', run with `bunx vitest run test/zz-scratch-claim2.test.ts --reporter=verbose --silent=false`: `runtime modifiers: true` / `(?s:a.b) find = []` / `(?s:a.b) truth = ["a\nb"]` / `(?s:.) find count = 14` vs `(?s:.) truth count = 16` / control `a[\s\S]b find = ["a\nb"]`. Engine support: `node v24.18.0 modifiers true` and `bun 1.3.10 modifiers true` for `new RegExp('(?s:.)','gu').test('\n')`. Probe deleted; git status clean.
```

## Input pipeline & a11y

### [MINOR] `packages/editor/src/editor/inputSelectionController.ts:2627`

**replaceAroundSelections builds one edit per caret from pre-edit offsets with no overlap merge, so a deduced edit wider than the gap between two carets throws out of the input listener.**

*Failure:* 

*Evidence:*

```
Scratch test, doc 'teh cat', `editor.setSelection(3,3)` then `session.addSelection(4)`, element set to 'the cat' sel 3 and a real `new Event('input',{bubbles:true})` dispatched on `.editor-virtualized-input`:
  [c3] carets 2 element "teh cat" 3 3
  [c3] threw = batch edits must not overlap
  [c3] doc = "teh cat"   <- correction silently dropped
```

### [MINOR] `packages/editor/src/editor/input.ts:190`

**The screen-reader window starts at a page boundary rather than a fixed distance behind the caret, so at column 0 of every Nth row the element holds nothing before the caret and a browser-driven backward delete is dropped.**

*Failure:* 

*Evidence:*

```
Real-Chromium test (browser project, playwright chromium), 60-row doc, focused hidden input, `document.execCommand('delete')` (a genuine deleteContentBackward):
  [b] page boundary (row20 col0): elementSel=0 elementHead="row20\nro" execCommand=true sawInputEvent=false docChanged=false around="8\nrow19\nrow20\n"
  [b] mid page (row25 col0):      elementSel=29 elementHead="row20\nro" execCommand=true sawInputEvent=true  docChanged=true  around="3\nrow24row25\nr"
happy-dom cross-check: [c4] window starts "row20\nrow21\n" sel 0 startOffset 120 caret 120 ; doc char before caret = "\n" ; live element = "row20\nrow21\n" sel 0
```

### [MINOR] `packages/editor/src/editor/input.ts:17`

**HiddenInputContent.startOffset — the field whose comment says it is 'where value starts in the document, so a caret inside it can be read back as an offset' — is never read by any production path.**

*Failure:* 

*Evidence:*

```
`grep -rn "HiddenInputContent|pagedHiddenInputContent" packages/*/src packages/*/test` -> input.ts:14,174,182; inputSelectionController.ts:61 (import), 1434 (the call); hiddenInput.test.ts:9,36. Nothing else. inputSelectionController.ts:1435-1442 reads `content.value`, `content.selectionStart`, `content.selectionEnd`, `content.direction` and stores `{selectionEnd, selectionStart, value}` — `startOffset` is dropped. hiddenInput.test.ts:150-152 and :163 are the only assertions on it.
```

## LSP plugin

### [MINOR] `packages/lsp/src/capabilities.ts:39`

**`commitCharactersSupport` is never advertised, so a conforming external server sends no `commitCharacters` and accept-on-commit-character is inert against it.**

*Failure:* 

*Evidence:*

```
Same probe as claim 2: `CAPS = {"contextSupport":true,"completionItem":{"documentationFormat":[...],"labelDetailsSupport":true,"resolveSupport":{...},"snippetSupport":true}}` — no commitCharactersSupport. `grep -rn "commitCharactersSupport" packages examples docs` -> no matches. completionCommit.ts:26; capabilities.ts:37-47; client.ts:87-89 vs lspConnection.ts:62-73; typescriptLsp.worker.ts:652; plugin.ts:753.
```

## Rendering & geometry

### [MINOR] `packages/editor/src/virtualization/virtualizedTextViewHiddenCharacters.ts:285`

**The whitespace marker takes its right edge as `offsetToX(view, row, offset + 1)` — buffer-offset arithmetic — so on a row carrying an inline replacement every display column of an injected run maps to one buffer offset and all its whitespace markers collapse onto a single box.**

*Failure:* 

*Evidence:*

```
Scratch vitest (dom project): mounted 'abcde fghij' with `hiddenCharacters:'show'`, characterWidth 10, then `setInlineMap(createInlineMap(snapshot, [{id:'ghost',startIndex:5,endIndex:5,text:' hi ',insertion:true}]))`. Logged `C4 row text "abcde hi  fghij" mapping? true` followed by three identical lines: `C4 marker kind=space offset=5 left=90px width=10px` — three spans for spaces at display columns 5, 8 and 9, all stacked at 90px.
```

### [MINOR] `packages/editor/src/virtualization/virtualizedTextViewHiddenCharacters.ts:312`

**The suspicious scan runs once per mounted chunk and `codePointStartAt` backs a range start onto the preceding high surrogate, so an astral character straddling a chunk boundary is reported by both chunks and gets two stacked markers.**

*Failure:* 

*Evidence:*

```
Scratch vitest (dom project) on `'x'.repeat(2047) + '\u{1d41a}' + 'y'.repeat(3000)`. Classifier: `C5 classifier chunk0 [{"start":2047,"end":2049,"kind":"ambiguous"}]` and `C5 classifier chunk1 [{"start":2047,"end":2049,"kind":"ambiguous"}]`. Mounted view with characterWidth 7.2266, 1200px viewport, `setScrollMetrics(0, 400, 1200, 2000 * 7.2266)`: `C5r chunks [[0,2048],[2048,4096]]`, `C5r markers ["ambiguous@2047","ambiguous@2047"]` — two DOM spans, both at left 2047px, for one character.
```

