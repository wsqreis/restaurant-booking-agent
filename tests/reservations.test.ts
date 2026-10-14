import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FRIDAY, MONDAY, service, TODAY } from './helpers.ts';

const booking = (overrides = {}) => ({ name: 'Ana', partySize: 2, date: FRIDAY, time: '19:00', ...overrides });

describe('ReservationService', () => {
  it('lists seating times from opening hours, stopping an hour before close', () => {
    const times = service().seatingTimes(FRIDAY);
    assert.deepEqual(times.slice(0, 5), ['12:00', '12:30', '13:00', '13:30', '14:00']);
    assert.equal(times.at(5), '18:00');
    assert.equal(times.at(-1), '21:30');
  });

  it('knows the current local time in the restaurant time zone', () => {
    assert.deepEqual(service().today(), { date: TODAY, time: '11:00', weekday: 3 });
  });

  it('books the smallest table that fits and returns a code', () => {
    const result = service().book(booking({ partySize: 3, notes: ' nut allergy ' }));
    assert.ok(result.ok);
    assert.equal(result.reservation.code, 'ABC234');
    assert.equal(result.reservation.tableSize, 4);
    assert.equal(result.reservation.notes, 'nut allergy');
  });

  it('rejects closed days, the past, far-future dates and big groups', () => {
    const reservations = service();
    const reasons = [
      reservations.book(booking({ date: MONDAY })),
      reservations.book(booking({ date: '2026-10-13' })),
      reservations.book(booking({ date: TODAY, time: '11:00' })),
      reservations.book(booking({ date: '2027-01-20' })),
      reservations.book(booking({ partySize: 12 })),
      reservations.book(booking({ date: '2026-02-30' })),
    ].map((result) => (result.ok ? 'ok' : result.reason));
    assert.deepEqual(reasons, ['CLOSED', 'IN_THE_PAST', 'IN_THE_PAST', 'TOO_FAR_AHEAD', 'PARTY_TOO_LARGE', 'INVALID_INPUT']);
  });

  it('points large groups to the phone line', () => {
    const result = service().book(booking({ partySize: 9 }));
    assert.ok(!result.ok);
    assert.match(result.message, /call \+44/);
  });

  it('offers the nearest times when a slot is outside opening hours', () => {
    const result = service().book(booking({ time: '16:00' }));
    assert.ok(!result.ok);
    assert.equal(result.reason, 'OUTSIDE_HOURS');
    // 14:00 and 18:00 are two hours away; on the 13:30/18:30 tie the earlier time wins.
    assert.deepEqual(result.alternatives, ['13:30', '14:00', '18:00']);
  });

  it('fills up when every big enough table is taken for the seating', () => {
    const reservations = service();
    // Two tables seat 6 or more: one 6-top and one 8-top.
    assert.ok(reservations.book(booking({ partySize: 6 })).ok);
    assert.ok(reservations.book(booking({ partySize: 6, time: '19:30' })).ok);

    const full = reservations.book(booking({ partySize: 5, time: '20:00' }));
    assert.ok(!full.ok);
    assert.equal(full.reason, 'FULLY_BOOKED');
    // 21:00 is free again: the 19:00 party has been seated for two hours by then.
    assert.ok(full.alternatives?.includes('21:00'));
    assert.ok(reservations.book(booking({ partySize: 5, time: '21:00' })).ok);
  });

  it('lists only times with a free table in availability', () => {
    const reservations = service();
    reservations.book(booking({ partySize: 8, time: '19:00' }));
    const result = reservations.availability(FRIDAY, 8);
    assert.ok(result.ok);
    assert.ok(!result.times.includes('19:00'));
    assert.ok(!result.times.includes('20:30'));
    assert.ok(result.times.includes('21:00'));
  });

  it('cancels once and frees the table', () => {
    const reservations = service();
    reservations.book(booking({ partySize: 8 }));
    assert.ok(reservations.cancel('abc234').ok, 'codes are case-insensitive');

    const again = reservations.cancel('ABC234');
    assert.ok(!again.ok);
    assert.equal(again.reason, 'ALREADY_CANCELLED');
    assert.ok(reservations.book(booking({ partySize: 8 })).ok);
  });

  it('reschedules without its own table blocking the new slot', () => {
    const reservations = service();
    reservations.book(booking({ partySize: 8, time: '19:00' }));
    const moved = reservations.reschedule('ABC234', { date: FRIDAY, time: '19:30' });
    assert.ok(moved.ok);
    assert.deepEqual(moved.previous, { date: FRIDAY, time: '19:00', partySize: 8 });
    assert.equal(moved.reservation.time, '19:30');
  });

  it('reports unknown codes', () => {
    const result = service().reschedule('ZZZ999', { date: FRIDAY, time: '19:00' });
    assert.ok(!result.ok);
    assert.equal(result.reason, 'NOT_FOUND');
  });
});
