import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { OpenRouterModel } from '../src/llm/model.ts';

// A local stand-in for OpenRouter's chat completions endpoint. Each model name picks a behaviour.
const BEHAVIOUR: Record<string, { status: number; body?: unknown }> = {
  'down/model': { status: 404, body: { error: { message: 'Provider returned error', code: 404 } } },
  'bad/key': { status: 401, body: { error: { message: 'No auth credentials found', code: 401 } } },
};

const completion = (model: string, tools: boolean) => ({
  id: 'gen-1',
  object: 'chat.completion',
  created: 0,
  model,
  choices: [
    {
      index: 0,
      finish_reason: tools ? 'tool_calls' : 'stop',
      message: tools
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'extract', arguments: '{"name":"Ana"}' } }] }
        : { role: 'assistant', content: `hello from ${model}` },
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

describe('OpenRouterModel', () => {
  let server: Server;
  let baseUrl: string;
  const calls: string[] = [];

  before(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const request = JSON.parse(body);
        calls.push(request.model);
        const behaviour = BEHAVIOUR[request.model] ?? { status: 200, body: completion(request.model, Boolean(request.tools)) };
        res.writeHead(behaviour.status, { 'content-type': 'application/json' }).end(JSON.stringify(behaviour.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  after(() => server.close());

  const modelWith = (models: string[]) =>
    new OpenRouterModel({ apiKey: 'test', baseUrl, models, temperature: 0, timeoutMs: 5000, appUrl: 'http://localhost', appName: 'test' });

  it('moves on to the next model when a provider is down', async () => {
    calls.length = 0;
    const model = modelWith(['down/model', 'up/model']);

    assert.deepEqual(await model.extract(z.object({ name: z.string() }), [new HumanMessage('Ana')]), { name: 'Ana' });
    assert.equal(await model.reply([new HumanMessage('hi')]), 'hello from up/model');
    assert.deepEqual(calls, ['down/model', 'up/model', 'down/model', 'up/model']);
  });

  it('does not try other models when the request itself is wrong', async () => {
    calls.length = 0;
    await assert.rejects(modelWith(['bad/key', 'up/model']).reply([new HumanMessage('hi')]), { status: 401 });
    assert.deepEqual(calls, ['bad/key']);
  });
});
