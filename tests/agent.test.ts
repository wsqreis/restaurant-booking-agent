import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentWith, FRIDAY, MONDAY, ScriptedModel } from './helpers.ts';

describe('booking agent graph', () => {
  it('collects missing details over several turns, then books', async () => {
    const model = new ScriptedModel().say(
      { intent: 'book', date: FRIDAY, time: '19:30' },
      { intent: 'other', partySize: 4 },
      { intent: 'other', name: 'Ana Silva' },
    );
    const { send, reservations } = agentWith(model);

    const first = await send('A table on Friday at 7:30pm please');
    assert.deepEqual(first.missing, ['partySize', 'name']);
    assert.equal(first.outcome, null);

    const second = await send('4 of us');
    assert.deepEqual(second.missing, ['name']);
    assert.equal(second.details.time, '19:30', 'details from earlier turns are kept');

    const third = await send('Ana Silva');
    assert.equal(third.outcome?.action, 'book');
    assert.equal(third.outcome?.ok, true);
    assert.equal(reservations.list().length, 1);
    assert.equal(reservations.list()[0]?.name, 'Ana Silva');
    // The request is closed, so the next message starts fresh.
    assert.equal(third.intent, null);
    assert.equal(third.details.date, null);
  });

  it('passes the service outcome to the reply prompt as the source of truth', async () => {
    const model = new ScriptedModel().say({ intent: 'book', date: FRIDAY, time: '19:00', partySize: 2, name: 'Bo' });
    await agentWith(model).send('Book Friday 7pm for 2, name Bo');
    assert.match(model.replyPrompts[0]!, /"code": "ABC234"/);
  });

  it('answers a side question without losing the booking in progress', async () => {
    const model = new ScriptedModel().say(
      { intent: 'book', date: FRIDAY, partySize: 2 },
      { intent: 'restaurant_info' },
      { intent: 'other', time: '20:00', name: 'Cy' },
    );
    const { send, reservations } = agentWith(model);

    await send('Table for 2 on Friday');
    const side = await send('Do you have vegan options?');
    assert.equal(side.turn, 'restaurant_info');
    assert.equal(side.intent, 'book');
    assert.equal(side.details.partySize, 2);
    assert.equal(side.outcome, null, 'a side question never triggers an action');

    const done = await send('8pm, name Cy');
    assert.equal(done.outcome?.ok, true);
    assert.equal(reservations.list()[0]?.time, '20:00');
  });

  it('keeps a failed booking open so the guest can pick an alternative', async () => {
    const model = new ScriptedModel().say(
      { intent: 'book', date: MONDAY, time: '19:00', partySize: 2, name: 'Di' },
      { intent: 'other', date: FRIDAY },
    );
    const { send } = agentWith(model);

    const failed = await send('Monday 7pm for 2, Di');
    assert.equal(failed.outcome?.ok, false);
    assert.equal((failed.outcome?.data as { reason: string }).reason, 'CLOSED');
    assert.equal(failed.intent, 'book');

    const retried = await send('Friday then');
    assert.equal(retried.outcome?.ok, true);
    assert.equal(retried.details.date, null, 'closed after success');
  });

  it('cancels by code, normalising its case', async () => {
    const model = new ScriptedModel().say(
      { intent: 'book', date: FRIDAY, time: '19:00', partySize: 2, name: 'Ed' },
      { intent: 'cancel', reservationCode: 'abc234' },
    );
    const { send, reservations } = agentWith(model);
    await send('Book Friday 7pm for 2, Ed');
    const cancelled = await send('cancel abc234');
    assert.equal(cancelled.outcome?.ok, true);
    assert.equal(reservations.list()[0]?.status, 'cancelled');
  });

  it('drops the previous request details when the guest switches to another request', async () => {
    const model = new ScriptedModel().say(
      { intent: 'book', date: FRIDAY, partySize: 6 },
      { intent: 'cancel' },
    );
    const { send } = agentWith(model);
    await send('Friday for 6');
    const switched = await send('Actually I want to cancel a booking');
    assert.equal(switched.intent, 'cancel');
    assert.equal(switched.details.partySize, null);
    assert.deepEqual(switched.missing, ['reservationCode']);
  });

  it('checks availability with a default party size of 2', async () => {
    const model = new ScriptedModel().say({ intent: 'check_availability', date: FRIDAY });
    const state = await agentWith(model).send('What is free on Friday?');
    assert.equal(state.outcome?.action, 'check_availability');
    assert.equal((state.outcome?.data as { partySize: number }).partySize, 2);
  });

  it('treats "None"-like strings from the model as missing, instead of booking under the name "None"', async () => {
    const model = new ScriptedModel().say(
      { intent: 'book', date: FRIDAY, time: '19:30', partySize: 2, name: 'None' },
      { intent: 'other', name: 'Ana Silva' },
    );
    const { send, reservations } = agentWith(model);

    const first = await send('Table for 2 on Friday at 7:30pm');
    assert.deepEqual(first.missing, ['name']);
    assert.equal(first.outcome, null);
    assert.equal(reservations.list().length, 0);

    const second = await send('Ana Silva');
    assert.equal(second.outcome?.ok, true);
    assert.deepEqual(reservations.list().map((r) => r.name), ['Ana Silva']);
  });
});
