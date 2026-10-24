// Independent cmark 0.31.2 receipts retained in qualification/exact-emphasis-r74.
// Original source units and explicit scalar/LF controls remain separate.
export type AttentionCore =
  | { type: 'text' | 'inlineCode'; value: string }
  | { type: 'emphasis' | 'strong'; children: AttentionCore[] }

type AttentionCase = {
  id: string
  source: string
  scalarLfSource: string
  sourceUtf16LeSha256: string
  oracleStdoutSha256: string
  paragraph: number
  expected: AttentionCore[]
}

function seededCodeExpectation({
  beforeCode,
  afterCode,
}: {
  beforeCode: string
  afterCode: string
}): AttentionCore[] {
  return [
    { type: 'text', value: '\ud83e\uddd1\u200d\ud83d\udcbbA **' },
    { type: 'strong', children: [{ type: 'text', value: 'seeded' }] },
    { type: 'text', value: beforeCode },
    { type: 'inlineCode', value: '* -|---' },
    { type: 'text', value: afterCode },
  ]
}

function strongExpectation({
  prefix,
  content,
  suffix,
}: {
  prefix: string
  content: string
  suffix: string
}): AttentionCore[] {
  return [
    { type: 'text', value: prefix },
    { type: 'strong', children: [{ type: 'text', value: content }] },
    { type: 'text', value: suffix },
  ]
}

export const independentAttentionCases = [
  {
    id: 'new-01',
    source: 'A **`*s]de**-` d*$x$$*_x$*```\r\n\nage._\n\n',
    scalarLfSource: 'A **`*s]de**-` d*$x$$*_x$*```\n\nage._\n\n',
    sourceUtf16LeSha256: '827d35b3bd7acf71b0d361a9c7931b29313b13de9192fb55c702c87dd57d95f4',
    oracleStdoutSha256: '9d81284ab787628745e3403a1fe4f8bd20aa42a19c9d93e392a1f509d7467009',
    paragraph: 0,
    expected: [
      {
        type: 'text',
        value: 'A *',
      },
      {
        type: 'emphasis',
        children: [
          {
            type: 'inlineCode',
            value: '*s]de**-',
          },
          {
            type: 'text',
            value: ' d',
          },
        ],
      },
      {
        type: 'text',
        value: '$x$$',
      },
      {
        type: 'emphasis',
        children: [
          {
            type: 'text',
            value: '_x$',
          },
        ],
      },
      {
        type: 'text',
        value: '```',
      },
    ],
  },
  {
    id: 'new-02',
    source:
      '**A(https\ud83e\uddd1\u200d$x$\ud83d\udcbb://****exam\ud83e\uddd1\u200d\ud83d\udcbbp| a | b|---|--`e.tes$(ht\u05d0\u05d1\u05d2tps://exam.test/a)x$t/a)ded**\uddd1\u200d\ud83d\udcbb messa_ge.\n',
    scalarLfSource:
      '**A(https\ud83e\uddd1\u200d$x$\ud83d\udcbb://****exam\ud83e\uddd1\u200d\ud83d\udcbbp| a | b|---|--`e.tes$(ht\u05d0\u05d1\u05d2tps://exam.test/a)x$t/a)ded**\ufffd\u200d\ud83d\udcbb messa_ge.\n',
    sourceUtf16LeSha256: '0d5866311ad38a430712f7bd720a6b020442e2329fab7d2f1d61ce81379a9b1a',
    oracleStdoutSha256: '704e77a71dad8029ed54ac69ead551138997ab163cee5ba662738e52faf1a0de',
    paragraph: 0,
    expected: [
      {
        type: 'text',
        value: '**A(https\ud83e\uddd1\u200d$x$\ud83d\udcbb://**',
      },
      {
        type: 'strong',
        children: [
          {
            type: 'text',
            value:
              'exam\ud83e\uddd1\u200d\ud83d\udcbbp| a | b|---|--`e.tes$(ht\u05d0\u05d1\u05d2tps://exam.test/a)x$t/a)ded',
          },
        ],
      },
      {
        type: 'text',
        value: '\ufffd\u200d\ud83d\udcbb messa_ge.',
      },
    ],
  },
  {
    id: 'new-03',
    source:
      '**A(http$x$s\ud83e\uddd1\u200d$x$\ud83d\udcbb://****exam\ud83e\uddd1\u200d\ud83d\udcbbp| a | b|---|--`e.tes$(ht\u05d0\u05d1\u05d2tps://exam.test/a)x$t/a)ded**\uddd1\u200d\ud83d\udcbb messa_ge.\n',
    scalarLfSource:
      '**A(http$x$s\ud83e\uddd1\u200d$x$\ud83d\udcbb://****exam\ud83e\uddd1\u200d\ud83d\udcbbp| a | b|---|--`e.tes$(ht\u05d0\u05d1\u05d2tps://exam.test/a)x$t/a)ded**\ufffd\u200d\ud83d\udcbb messa_ge.\n',
    sourceUtf16LeSha256: 'ce44b2341f5aae9b3df0a57f9dab86e89c915ccaf98c07a066eeaeac7d46ba62',
    oracleStdoutSha256: '02fda630ba66bf77b9cb9951446b9755603867ece95f38a8baf77744b4f6849f',
    paragraph: 0,
    expected: [
      {
        type: 'text',
        value: '**A(http$x$s\ud83e\uddd1\u200d$x$\ud83d\udcbb://**',
      },
      {
        type: 'strong',
        children: [
          {
            type: 'text',
            value:
              'exam\ud83e\uddd1\u200d\ud83d\udcbbp| a | b|---|--`e.tes$(ht\u05d0\u05d1\u05d2tps://exam.test/a)x$t/a)ded',
          },
        ],
      },
      {
        type: 'text',
        value: '\ufffd\u200d\ud83d\udcbb messa_ge.',
      },
    ],
  },
  {
    id: 'new-04',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;test/a)ag(https://example.test/a)e.\n\n\n\n',
    scalarLfSource:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;test/a)ag(https://example.test/a)e.\n\n\n\n',
    sourceUtf16LeSha256: '5aea04237a60cc0384c81e0789ac8b79b544ec29c45d468a687afdefb3dfec47',
    oracleStdoutSha256: 'e95035ca11cf0da4d708b8d8cd4337df0f002ab36ff4e4fb996a6d1fb0b2b12a',
    paragraph: 0,
    expected: seededCodeExpectation({
      beforeCode: ' mess(httpsxam&am**p;pl| a | b |\n|--',
      afterCode: '\n|\ne.&am;test/a)ag(https://example.test/a)e.',
    }),
  },
  {
    id: 'new-05',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;test/a)ag//example.test/a)e.\n\n\n\n',
    scalarLfSource:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;test/a)ag//example.test/a)e.\n\n\n\n',
    sourceUtf16LeSha256: 'b65165e1eccbd6d0799bbd0e40e78fe60757f09ea2b9900b16a826e70b252680',
    oracleStdoutSha256: 'e1d8e60eb65c92c3470af6dbd6edf51c9ca3dff9b35d3fd845de3868705bcf3a',
    paragraph: 0,
    expected: seededCodeExpectation({
      beforeCode: ' mess(httpsxam&am**p;pl| a | b |\n|--',
      afterCode: '\n|\ne.&am;test/a)ag//example.test/a)e.',
    }),
  },
  {
    id: 'new-06',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;te&amp;st/a)ag//example.test/a)e.\n\n\n\n',
    scalarLfSource:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;te&amp;st/a)ag//example.test/a)e.\n\n\n\n',
    sourceUtf16LeSha256: '44ebe593a5c42e578cae9924badb68132bac7f5d716709df2cfa7ffd351d1e1d',
    oracleStdoutSha256: '8eab5664b7807003a87d35e47009e7ff75e7a4411b7e9386813fbdfa9830d873',
    paragraph: 0,
    expected: seededCodeExpectation({
      beforeCode: ' mess(httpsxam&am**p;pl| a | b |\n|--',
      afterCode: '\n|\ne.&am;te&st/a)ag//example.test/a)e.',
    }),
  },
  {
    id: 'new-07',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;te```\n&amp;st/a)ag//example.test/a)e.\n\n\n\n',
    scalarLfSource:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxam&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;te```\n&amp;st/a)ag//example.test/a)e.\n\n\n\n',
    sourceUtf16LeSha256: '27eb2b06ffc3fb9b95ea837d756fd62be1c25a696dd2ba13d0e0d13c6641b240',
    oracleStdoutSha256: 'f4380c779dc5bd3ef4a07c06e1d7a91323da7c6d9591175d7991e38cf3fff8db',
    paragraph: 0,
    expected: seededCodeExpectation({
      beforeCode: ' mess(httpsxam&am**p;pl| a | b |\n|--',
      afterCode: '\n|\ne.&am;te```\n&st/a)ag//example.test/a)e.',
    }),
  },
  {
    id: 'new-08',
    source:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxa\r\nm&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;te```\n&amp;st/a)ag//example.test/a)e.\n\n\n\n',
    scalarLfSource:
      '\ud83e\uddd1\u200d\ud83d\udcbbA ****seeded** mess(httpsxa\nm&am**p;pl| a | b |\n|--```*\n-|---```\n|\ne.&am;te```\n&amp;st/a)ag//example.test/a)e.\n\n\n\n',
    sourceUtf16LeSha256: 'dd34c427c43a0c9cceca0403bfeeeaa5e113f9e137a23fc928e07a8554c2b1dc',
    oracleStdoutSha256: 'f1ed0570f1cae3fbdc641f403087c3d50fbbe0ed1745f94f78e1ec6060b1deb7',
    paragraph: 0,
    expected: seededCodeExpectation({
      beforeCode: ' mess(httpsxa\nm&am**p;pl| a | b |\n|--',
      afterCode: '\n|\ne.&am;te```\n&st/a)ag//example.test/a)e.',
    }),
  },
  {
    id: 'new-09',
    source:
      'A **\n\nsee]et\n--\ud83e*\uddd1**[x]: /target\n(&amp;https[x]://e\r$x$\u05d0\n\u05d0\u05d1\u05d2\n\u05d1a) [x]: /targ**et\nmes`',
    scalarLfSource:
      'A **\n\nsee]et\n--\ufffd*\ufffd**[x]: /target\n(&amp;https[x]://e\n$x$\u05d0\n\u05d0\u05d1\u05d2\n\u05d1a) [x]: /targ**et\nmes`',
    sourceUtf16LeSha256: '1641fd45acbfed9e183b824e57bcb1ee038ac1f2cc26478dc226a6692bb7ad0b',
    oracleStdoutSha256: 'dd01960a004d5ab790d3ff6060fb78845537d1a56348a8022c819a92a6cfd1aa',
    paragraph: 1,
    expected: [
      {
        type: 'text',
        value: 'see]et\n--\ufffd*\ufffd',
      },
      {
        type: 'strong',
        children: [
          {
            type: 'text',
            value:
              '[x]: /target\n(&https[x]://e\n$x$\u05d0\n\u05d0\u05d1\u05d2\n\u05d1a) [x]: /targ',
          },
        ],
      },
      {
        type: 'text',
        value: 'et\nmes`',
      },
    ],
  },
  {
    id: 'new-10',
    source: 'A ****sd** me**ssage.\n\n',
    scalarLfSource: 'A ****sd** me**ssage.\n\n',
    sourceUtf16LeSha256: 'b5be2cc711df9fd448d30ffd8dd0eab11d33979a73ba859a1b988d4428d523b8',
    oracleStdoutSha256: 'db20e59826d6db28707ec9385aad11f384e7f5cc5bb6c40f3041ac6f3c72dee4',
    paragraph: 0,
    expected: strongExpectation({ prefix: 'A **', content: 'sd', suffix: ' me**ssage.' }),
  },
  {
    id: 'new-11',
    source: 'A ****sd** me**ssage.\n\n\n\n',
    scalarLfSource: 'A ****sd** me**ssage.\n\n\n\n',
    sourceUtf16LeSha256: 'd072d5a17334a2e599534195787abdab5e9617defb7600e406eb97a111de3880',
    oracleStdoutSha256: 'db20e59826d6db28707ec9385aad11f384e7f5cc5bb6c40f3041ac6f3c72dee4',
    paragraph: 0,
    expected: strongExpectation({ prefix: 'A **', content: 'sd', suffix: ' me**ssage.' }),
  },
  {
    id: 'new-12',
    source: 'A ****sd*e**ssage.\n\n\n\n',
    scalarLfSource: 'A ****sd*e**ssage.\n\n\n\n',
    sourceUtf16LeSha256: '18a3add33ee7f4d66b760b0656bd80388fc9d403dacd327d23168c7a20bd2988',
    oracleStdoutSha256: '67c820d8784f1132a2f89493763b328d4818fc5fe0cd5a60c8ecd4acf002662b',
    paragraph: 0,
    expected: [
      {
        type: 'text',
        value: 'A ***',
      },
      {
        type: 'emphasis',
        children: [
          {
            type: 'text',
            value: 'sd',
          },
        ],
      },
      {
        type: 'text',
        value: 'e**ssage.',
      },
    ],
  },
  {
    id: 'new-13',
    source: 'A ****sd*```\ne**ssage.\n\n\n\n',
    scalarLfSource: 'A ****sd*```\ne**ssage.\n\n\n\n',
    sourceUtf16LeSha256: 'be9f11248214097c0d930401d1fce91ae1c4311c3374a34814a5fa8f836db05a',
    oracleStdoutSha256: 'a688d588751006a4dcd392344556578bfdb5237518e01161c8084534a643354e',
    paragraph: 0,
    expected: [
      {
        type: 'text',
        value: 'A ***',
      },
      {
        type: 'emphasis',
        children: [
          {
            type: 'text',
            value: 'sd',
          },
        ],
      },
      {
        type: 'text',
        value: '```\ne**ssage.',
      },
    ],
  },
  {
    id: 'new-14',
    source:
      'A|--|--**-|\n\u05d2- **seed*[x]: /target\ne| a | b |\n|---|---|\nd**\ud83e\uddd1\u200d\ud83d\udcbb* ma_> *\r\n* [x]]:- \ud83e\uddd1\u200d\ud83d\udcbb /t| a | b |\n|**---|---|\narge**te.\u05d0\u05d1\u05d2\n*&amp;\u05d0\u05d1\u05d2*\n',
    scalarLfSource:
      'A|--|--**-|\n\u05d2- **seed*[x]: /target\ne| a | b |\n|---|---|\nd**\ud83e\uddd1\u200d\ud83d\udcbb* ma_> *\n* [x]]:- \ud83e\uddd1\u200d\ud83d\udcbb /t| a | b |\n|**---|---|\narge**te.\u05d0\u05d1\u05d2\n*&amp;\u05d0\u05d1\u05d2*\n',
    sourceUtf16LeSha256: '46aa408409d343c5f578946c6e39d37cb9aaf57409b48ddb6cda8111f30c0c70',
    oracleStdoutSha256: 'eb1e29101625823f55f406432bc2654afd9a750d6b8716a75dc2e50a6614b874',
    paragraph: 0,
    expected: [
      {
        type: 'text',
        value: 'A|--|--*',
      },
      {
        type: 'emphasis',
        children: [
          {
            type: 'text',
            value: '-|\n\u05d2- ',
          },
          {
            type: 'emphasis',
            children: [
              {
                type: 'emphasis',
                children: [
                  {
                    type: 'text',
                    value: 'seed',
                  },
                ],
              },
              {
                type: 'text',
                value: '[x]: /target\ne| a | b |\n|---|---|\nd',
              },
            ],
          },
        ],
      },
      {
        type: 'text',
        value: '\ud83e\uddd1\u200d\ud83d\udcbb* ma_> *',
      },
    ],
  },
  {
    id: 'new-15',
    source: 'A **s*e\ud83e\uddd1\u200dd*\ud83e\uddd1\u200d\ud83d\udcbb* | a \r\n[\r\nx] |*---|*\n',
    scalarLfSource:
      'A **s*e\ud83e\uddd1\u200dd*\ud83e\uddd1\u200d\ud83d\udcbb* | a \n[\nx] |*---|*\n',
    sourceUtf16LeSha256: '3457347c606a189155e8cfddc194be7409cad52d6038b3a5555ed566096c5501',
    oracleStdoutSha256: 'c79f7a633897bd9f1707d5365350b157afd85412e2b1957e97471d4ba31404de',
    paragraph: 0,
    expected: [
      {
        type: 'text',
        value: 'A *',
      },
      {
        type: 'emphasis',
        children: [
          {
            type: 'text',
            value: 's',
          },
          {
            type: 'emphasis',
            children: [
              {
                type: 'text',
                value: 'e\ud83e\uddd1\u200dd',
              },
            ],
          },
          {
            type: 'text',
            value: '\ud83e\uddd1\u200d\ud83d\udcbb',
          },
        ],
      },
      {
        type: 'text',
        value: ' | a\n[\nx] |',
      },
      {
        type: 'emphasis',
        children: [
          {
            type: 'text',
            value: '---|',
          },
        ],
      },
    ],
  },
] satisfies readonly AttentionCase[]
