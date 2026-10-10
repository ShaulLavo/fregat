# Chat dictation

The web composer uses browser speech recognition with T3 Code's draft insertion rules and mic, finish and cancel actions. Finishing inserts the transcript into the selected range of the draft. Sending remains a separate action. Dictation freezes editing and sending, and cancels when the draft owner changes or the page becomes hidden.

The copied draft resolver comes from [T3 Code's voice controller](https://github.com/pingdotgg/t3code/blob/cd41c4ada0c70cc2eec95ecd7266f3dab010c58c/packages/client-runtime/src/voice-input/controller.ts). The local reference clone was updated from `ce90eec1f` to `cd41c4ada` on 2026-10-07. The new controller includes abandoned-session coordination; its owner, text and revision checks and English word-boundary rules remain the basis of the copied resolver. The MIT notice is retained in [the public license notice](../apps/web/public/licenses/t3code.txt).

T3 Code's transcription engine is an iOS 26 Apple API, exposed through React Native. Its current web and desktop composers have no equivalent engine. Fregat uses `SpeechRecognition` or `webkitSpeechRecognition` on secure origins. Browsers without either API hide the microphone control. The browser language selects the transcription language. The browser provider may process audio remotely and require a connection. This also depends on recognition support in the desktop app's browser host.

`chat.dictationLimitSeconds` defaults to 300 seconds, matching T3's five-minute recording limit. The setting is application-scoped and consumed by `use-voice-input.ts`.

The `chat-dictation` verification scenario injects only the external browser speech API and drives the real composer. It checks selected-text replacement, interim preview, editing and sending restrictions, cancellation, microphone errors and automatic completion, with desktop and phone screenshots. The fixture does not verify transcription accuracy, actual microphone permissions or recognition service availability. Those require an ad hoc microphone check in the target browser.

The production bundle measurement compares unchanged main `ac0669109` with complete dictation source `29c708072`, using the same lockfile. Dictation adds 3,106 gzip bytes to the phone conversation: 1,483,830 → 1,486,936. Desktop startup changes by 34 bytes and the phone session list by 40 bytes. These historical byte counts describe download size and make no claim about runtime speed. Bundle size is not gated. The report used for these measurements is available in the named source revisions.

The composer shows “Starting microphone…” until both the recognition service and the browser audio-capture events arrive. “Listening…” means both have started. When audio capture ends, the status becomes “Transcribing…” while final results arrive. This status does not guarantee recognition accuracy. The browser still performs transcription using its existing language and recognition engine.

One `chat.voice.capture` event per operation records service start, audio start/end, readiness, first-result timings, result/segment counts and outcome. It contains no transcript or audio. These fields distinguish readiness delays from a browser returning incomplete results.
