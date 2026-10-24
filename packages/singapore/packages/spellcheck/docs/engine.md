# spellcheck engine notes

## what gets checked

in an editor, the default `prose` scope checks plain text and markdown prose. `proseAndCode` adds comments and strings in code. markdown code, link targets and labels, and anything an inline replacement stands in for are skipped

`tokenizeSpellWords(text, { mode, excluded })` picks the words. in `prose` mode it skips acronyms, camelCase, words with digits or `_`, runs with letters outside ascii, urls, email addresses, paths and the `excluded` ranges. `mode: 'code'` splits camelCase and snake_case into words

## language and work limits

the bundled dictionary checks english. there is no natural-language detection. prose candidates contain ascii letters and internal straight or typographic apostrophes. `hola mundo` goes to the english checker; `שלום`, `привет` and `café` are skipped, which also skips accented words that occur in english. the programming language decides which editor regions count as prose

whitespace-delimited chunks longer than 256 utf-16 code units are skipped before structured-text classification. the editor skips prose lines and code regions longer than 16,384 code units before reading them. this bounds synchronous work on generated text and large pastes. short chunks around them stay checkable through `tokenizeSpellWords`

## failures

worker setup and posting failures reject `check` and `suggest`, settle every outstanding request, and terminate that worker. the next service request creates a fresh worker and resends accepted words. an editor that sees a check failure stops requesting checks for its lifetime, so typing cannot start a retry loop. a failed accepted-word sync keeps the local list for the next worker and notifies listeners. disposal rejects outstanding requests and prevents a restart

## adding languages

the plan for dictionaries beyond english

add an explicit `languages` selection, separate from syntax language, defaulting to english. start with manually selected dictionaries. a mixed-language document accepts a word found in any selected dictionary, and suggestions merge and deduplicate in configured language order. automatic language detection is out of scope

the shared service loads dictionaries lazily from a language manifest. each entry records its source, version, attribution and verified permissive data license. review these for each dictionary, because the engine license does not cover dictionary data. bundle english only and load other selected dictionaries on demand

tokenization changes with dictionary selection: unicode letters and marks, language-specific word segmentation, apostrophe policy and nfc normalization, all preserving the original utf-16 offsets. script selection stays explicit, so mixed scripts are checked only when a selected dictionary supports them. case folding is defined per dictionary; accents are kept

a language change starts a new dictionary generation. it clears controller verdicts, pending-word sets, cached line tokenization and painted issues, and ignores replies from the previous generation. the new generation publishes once all selected dictionaries load. a load failure keeps the previous complete selection active and reports the failed selection to the host. accepted words belong to the user and sync into the new generation

## reading the benchmark

`bun run bench:engine` runs the norvig spell-testset1/2 pairs. it reports total pairs, target-word coverage, and misspellings the dictionary accepts even though it covers the target. suggestion ranking runs only on pairs where the dictionary accepts the target and rejects the typo

`eligibleRankingPairs` is the denominator of `eligibleTop1Percent` and `eligibleTop5Percent`. compare engines on the same pair set, and report coverage and missed typos next to ranking. the ranking percentages are conditional, so they say nothing about overall typo detection

`bun run bench:typing` measures the main-thread time spellcheck adds to each keystroke
