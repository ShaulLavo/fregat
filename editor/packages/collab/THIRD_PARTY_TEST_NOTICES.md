# Third-party test notices

These synthetic workloads are adapted to Singapore ID-space edits. Provenance
headers identify their original tests and pinned revisions. Runtime dependency
notices remain in `THIRD_PARTY_LICENSES`. No Fugue B4 editing trace is included.

## Loro

Source: https://github.com/loro-dev/loro
Revision: `c00c9fa501f8d32f68d6255eacb7035a67fb6ab6`.
Adapted placement, tombstone-origin, Unicode, cursor and plain-text generator tests.

MIT License

Copyright (c) 2023 Loro

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Yjs

Source: https://github.com/yjs/yjs
Revision: `d01eefc997cf12d29d5aabea804df5f69c659a79`.
Adapted basic text, character-array, relative-position and message scheduler tests.

The MIT License (MIT)

Copyright (c) 2023

- Kevin Jahns <kevin.jahns@protonmail.com>.
- Chair of Computer Science 5 (Databases & Information Systems), RWTH Aachen University, Germany

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## FugueMax reference oracle

Source: https://github.com/mweidner037/fugue
Revision: `31e74fea67f23add13a5d10f781c0d78edcd14da`.
The test oracle adapts `fugue-max-simple/src/index.ts`. It retains the tree
placement and traversal and removes the Collabs transport and serialization.
The MIT grant below applies to that subtree. Its exceptions for `fugue/` and
the B4 dataset are outside these ports.

All files in this project, except b4-editing-trace.js and the fugue/ directory, are licensed under the MIT license:

The MIT License (MIT)

Copyright (c) 2023 Matthew Weidner and Martin Kleppmann.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Diamond Types

Source: https://github.com/josephg/diamond-types
Revision: `89ae3a0ab8d941a2885e6ec89d094bc9ce9d2922`.
Adapted synthetic local editor, backward insertion/backspace, concurrent deletion
and merge-generator workloads. The implementation uses Singapore envelopes and
an independent scalar-array oracle. Rust fixtures and encoded data are excluded.

Upstream declares ISC in `Cargo.toml` and `README.md`. This revision supplies no
standalone license file or copyright line. Attribution is to Seph Gentle and
Diamond Types contributors, consistent with the source repository and commit
author. No copyright year has been inferred. The full ISC permission and
warranty text follows.

ISC License

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
