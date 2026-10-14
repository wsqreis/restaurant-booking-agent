import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemorySaver } from '@langchain/langgraph';
import { buildAgent } from '../src/agent/graph.ts';
import { buildApp } from '../src/server.ts';
import { FRIDAY, ScriptedModel, service } from './helpers.ts';

function appWith(model: ScriptedModel) {
  const reservations = service();
  return buildApp({ agent: buildAgent(model, reservations, new MemorySaver()), reservations });
}

const chat = (app: ReturnType<typeof appWith>, payload: object) =>
  app.inject({ method: 'POST', url: '/api/chat', payload });

describe('HTTP API', () => {
  it('starts a thread and continues it with the returned threadId', async () => {
    const model = new ScriptedModel().say(
      { intent: 'book', date: FRIDAY, time: '19:00' },
      { intent: 'other', partySize: 2, name: 'Flo' },
    );
    const app = appWith(model);

    const first = await chat(app, { message: 'Friday at 7' });
    assert.equal(first.statusCode, 200);
    const { threadId, reply, debug } = first.json();
    assert.match(threadId, /^[0-9a-f-]{36}$/);
    assert.equal(reply, 'reply #1');
    assert.deepEqual(debug.missing, ['partySize', 'name']);

    const second = await chat(app, { message: '2 people, Flo', threadId });
    assert.equal(second.json().debug.outcome.ok, true);

    const book = await app.inject({ method: 'GET', url: '/api/reservations' });
    assert.equal(book.json().reservations.length, 1);
  });

  it('validates the request body', async () => {
    const app = appWith(new ScriptedModel());
    assert.equal((await chat(app, { message: '' })).statusCode, 400);
    assert.equal((await chat(app, { message: 'hi', threadId: 'not-a-uuid' })).statusCode, 400);
  });

  it('returns 502 with a friendly message when the LLM fails', async () => {
    const model = new ScriptedModel();
    model.failWith = new Error('upstream 503');
    const response = await chat(appWith(model), { message: 'hello' });
    assert.equal(response.statusCode, 502);
    assert.doesNotMatch(response.body, /upstream 503/);
  });

  it('serves the demo page', async () => {
    const response = await appWith(new ScriptedModel()).inject({ method: 'GET', url: '/' });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /The Olive Table/);
  });
});
