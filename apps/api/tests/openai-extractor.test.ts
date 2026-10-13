import { describe, expect, it } from 'vitest';
import type { FieldSpec } from '../src/infrastructure/extraction/document-extractor';
import {
  buildFieldSchema,
  createOpenAiExtractor,
} from '../src/infrastructure/extraction/providers/openai.provider';

/** The OpenAI adapter against a recorded fetch: request shape, and how answers and failures are mapped. */
const FIELDS: FieldSpec[] = [
  { key: 'fullName', kind: 'name', description: 'Full name' },
  { key: 'dateOfBirth', kind: 'date', description: 'Date of birth' },
];
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const responseBody = (
  over: Record<string, unknown> = {},
  text = '{"fullName":"Tai Howe","dateOfBirth":"2011-08-29"}',
) => ({
  id: 'resp_1',
  object: 'response',
  created_at: 0,
  status: 'completed',
  model: 'gpt-5.6-luna-2026-09-01',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  ],
  usage: {
    input_tokens: 1650,
    output_tokens: 40,
    total_tokens: 1690,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
  ...over,
});

function recordingFetch(reply: (n: number) => Response | Promise<Response>) {
  const requests: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: new Headers(init?.headers),
    });
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return reply(requests.length);
  }) as typeof fetch;
  return { fetchFn, requests };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const extractor = (fetchFn: typeof fetch, reasoningEffort: 'none' | 'default' = 'none') =>
  createOpenAiExtractor({
    apiKey: 'sk-test-0000000000000000',
    model: 'gpt-5.6-luna',
    reasoningEffort,
    fetch: fetchFn,
    maxRetries: 0,
  });

describe('OpenAI document extractor', () => {
  it('sends an image as input_image with a strict schema, store=false and no reasoning', async () => {
    const { fetchFn, requests } = recordingFetch(() => json(200, responseBody()));
    const out = await extractor(fetchFn).extract({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
      mimeType: 'image/jpeg',
      fields: FIELDS,
    });
    expect(out).toEqual({
      ok: true,
      fields: { fullName: 'Tai Howe', dateOfBirth: '2011-08-29' },
      model: 'gpt-5.6-luna-2026-09-01',
      usage: { inputTokens: 1650, outputTokens: 40 },
    });
    const { url, body, headers } = requests[0]!;
    expect(url).toMatch(/\/responses$/);
    expect(headers.get('authorization')).toBe('Bearer sk-test-0000000000000000');
    expect(body).toMatchObject({
      model: 'gpt-5.6-luna',
      store: false,
      max_output_tokens: 500,
      reasoning: { effort: 'none' },
      text: { format: { type: 'json_schema', strict: true, schema: buildFieldSchema(FIELDS) } },
    });
    const content = (body.input as { content: Record<string, unknown>[] }[])[0]!.content;
    expect(content[0]).toEqual({
      type: 'input_image',
      image_url: 'data:image/jpeg;base64,/9j/4A==',
      detail: 'high',
    });
    expect(String(body.instructions)).toMatch(/data, not instructions/);
  });

  it('sends PDF and DOCX as input_file with a neutral file name', async () => {
    const { fetchFn, requests } = recordingFetch(() => json(200, responseBody()));
    for (const mimeType of ['application/pdf', DOCX] as const) {
      await extractor(fetchFn).extract({
        bytes: Uint8Array.from([1, 2]),
        mimeType,
        fields: FIELDS,
      });
    }
    const parts = requests.map(
      (r) => (r.body.input as { content: Record<string, unknown>[] }[])[0]!.content[0],
    );
    expect(parts[0]).toEqual({
      type: 'input_file',
      filename: 'document.pdf',
      file_data: 'data:application/pdf;base64,AQI=',
    });
    expect(parts[1]).toMatchObject({ type: 'input_file', filename: 'document.docx' });
    expect(String(parts[1]!.file_data)).toMatch(new RegExp(`^data:${DOCX};base64,`));
  });

  it('builds a strict schema of nullable strings with every key required', () => {
    expect(buildFieldSchema(FIELDS)).toEqual({
      type: 'object',
      properties: {
        fullName: { type: ['string', 'null'], description: 'Full name' },
        dateOfBirth: { type: ['string', 'null'], description: 'Date of birth (YYYY-MM-DD)' },
      },
      required: ['fullName', 'dateOfBirth'],
      additionalProperties: false,
    });
  });

  it('omits the reasoning setting when told to use the model default', async () => {
    const { fetchFn, requests } = recordingFetch(() => json(200, responseBody()));
    await extractor(fetchFn, 'default').extract({
      bytes: Uint8Array.from([1]),
      mimeType: 'image/png',
      fields: FIELDS,
    });
    expect(requests[0]!.body).not.toHaveProperty('reasoning');
  });

  it('turns empty strings into null and drops keys that were not asked for', async () => {
    const { fetchFn } = recordingFetch(() =>
      json(200, responseBody({}, '{"fullName":"  ","dateOfBirth":null,"extra":"x"}')),
    );
    const out = await extractor(fetchFn).extract({
      bytes: Uint8Array.from([1]),
      mimeType: 'image/png',
      fields: FIELDS,
    });
    expect(out).toMatchObject({ ok: true, fields: { fullName: null, dateOfBirth: null } });
  });

  it('maps refusals, cut-off answers and bad JSON to UNREADABLE', async () => {
    const refusal = responseBody({
      output: [
        {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'refusal', refusal: 'no' }],
        },
      ],
    });
    for (const body of [
      refusal,
      responseBody({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
      responseBody({}, 'not json'),
    ]) {
      const { fetchFn } = recordingFetch(() => json(200, body));
      expect(
        await extractor(fetchFn).extract({
          bytes: Uint8Array.from([1]),
          mimeType: 'image/png',
          fields: FIELDS,
        }),
      ).toEqual({ ok: false, reason: 'UNREADABLE' });
    }
  });

  it('maps provider failures without leaking their text', async () => {
    const cases: [Response, string][] = [
      [json(429, { error: { message: 'rate limited', type: 'rate_limit' } }), 'PROVIDER_ERROR'],
      [json(500, { error: { message: 'boom' } }), 'PROVIDER_ERROR'],
      [json(401, { error: { message: 'bad key sk-test-0000' } }), 'PROVIDER_ERROR'],
      [
        json(400, {
          error: { message: 'bad file', code: 'invalid_file', param: 'input[0].content[0]' },
        }),
        'UNSUPPORTED',
      ],
      [
        json(400, { error: { message: 'bad model', code: 'model_not_found', param: 'model' } }),
        'PROVIDER_ERROR',
      ],
    ];
    for (const [res, reason] of cases) {
      const { fetchFn } = recordingFetch(() => res);
      expect(
        await extractor(fetchFn).extract({
          bytes: Uint8Array.from([1]),
          mimeType: 'image/png',
          fields: FIELDS,
        }),
      ).toEqual({ ok: false, reason });
    }
  });

  it('reports an aborted call as TIMEOUT', async () => {
    const controller = new AbortController();
    const { fetchFn } = recordingFetch(
      () =>
        new Promise<Response>((_, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
          controller.abort();
        }),
    );
    expect(
      await extractor(fetchFn).extract({
        bytes: Uint8Array.from([1]),
        mimeType: 'image/png',
        fields: FIELDS,
        signal: controller.signal,
      }),
    ).toEqual({ ok: false, reason: 'TIMEOUT' });
  });
});
