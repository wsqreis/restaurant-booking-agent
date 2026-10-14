import { randomInt } from 'node:crypto';
import type { Restaurant } from './restaurant.ts';
import { addDays, fromMinutes, isValidDate, isValidTime, localNow, toMinutes, weekdayOf } from './time.ts';

export type Reservation = {
  code: string;
  name: string;
  partySize: number;
  date: string;
  time: string;
  tableSize: number;
  notes: string | null;
  status: 'confirmed' | 'cancelled';
};

export type BookingRequest = {
  name: string;
  partySize: number;
  date: string;
  time: string;
  notes?: string | null;
};

export type FailureReason =
  | 'INVALID_INPUT'
  | 'IN_THE_PAST'
  | 'TOO_FAR_AHEAD'
  | 'CLOSED'
  | 'OUTSIDE_HOURS'
  | 'PARTY_TOO_LARGE'
  | 'FULLY_BOOKED'
  | 'NOT_FOUND'
  | 'ALREADY_CANCELLED';

export type Failure = {
  ok: false;
  reason: FailureReason;
  message: string;
  /** Bookable times on the same day, nearest first, when the requested one is not. */
  alternatives?: string[];
};

export type Result<T> = ({ ok: true } & T) | Failure;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, easy to read out loud

const fail = (reason: FailureReason, message: string, alternatives?: string[]): Failure => ({
  ok: false,
  reason,
  message,
  ...(alternatives?.length ? { alternatives } : {}),
});

/**
 * Deterministic booking rules: opening hours, booking window and table assignment.
 * The agent never decides availability itself; it only calls this service.
 */
export class ReservationService {
  readonly restaurant: Restaurant;
  readonly #reservations = new Map<string, Reservation>();
  readonly #now: () => Date;
  readonly #newCode: () => string;

  constructor(restaurant: Restaurant, options: { now?: () => Date; newCode?: () => string } = {}) {
    this.restaurant = restaurant;
    this.#now = options.now ?? (() => new Date());
    this.#newCode =
      options.newCode ?? (() => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''));
  }

  today(): { date: string; time: string; weekday: number } {
    return localNow(this.#now(), this.restaurant.timeZone);
  }

  /** Every time on the slot grid a party could start, ignoring existing bookings. */
  seatingTimes(date: string): string[] {
    const periods = this.restaurant.openingHours[weekdayOf(date)] ?? [];
    const times: string[] = [];
    for (const { open, close } of periods) {
      const last = toMinutes(close) - this.restaurant.lastSeatingBeforeCloseMinutes;
      for (let minute = toMinutes(open); minute <= last; minute += this.restaurant.slotMinutes) {
        times.push(fromMinutes(minute));
      }
    }
    return times;
  }

  availability(date: string, partySize: number): Result<{ date: string; partySize: number; times: string[] }> {
    const invalid = this.#validateDay(date, partySize);
    if (invalid) return invalid;
    const today = this.today();
    const times = this.seatingTimes(date).filter(
      (time) => (date !== today.date || time > today.time) && this.#freeTable(date, time, partySize) !== null,
    );
    return { ok: true, date, partySize, times };
  }

  book(request: BookingRequest): Result<{ reservation: Reservation }> {
    const name = request.name.trim();
    if (!name) return fail('INVALID_INPUT', 'A name is required for the booking.');
    const checked = this.#checkSlot(request.date, request.time, request.partySize);
    if (!checked.ok) return checked;

    const reservation: Reservation = {
      code: this.#uniqueCode(),
      name,
      partySize: request.partySize,
      date: request.date,
      time: request.time,
      tableSize: checked.tableSize,
      notes: request.notes?.trim() || null,
      status: 'confirmed',
    };
    this.#reservations.set(reservation.code, reservation);
    return { ok: true, reservation };
  }

  find(code: string): Result<{ reservation: Reservation }> {
    const reservation = this.#reservations.get(code.trim().toUpperCase());
    if (!reservation) return fail('NOT_FOUND', `No reservation found with code ${code.toUpperCase()}.`);
    return { ok: true, reservation };
  }

  cancel(code: string): Result<{ reservation: Reservation }> {
    const found = this.find(code);
    if (!found.ok) return found;
    if (found.reservation.status === 'cancelled') {
      return fail('ALREADY_CANCELLED', `Reservation ${found.reservation.code} was already cancelled.`);
    }
    found.reservation.status = 'cancelled';
    return { ok: true, reservation: found.reservation };
  }

  reschedule(
    code: string,
    change: { date: string; time: string; partySize?: number },
  ): Result<{ reservation: Reservation; previous: { date: string; time: string; partySize: number } }> {
    const found = this.find(code);
    if (!found.ok) return found;
    const { reservation } = found;
    if (reservation.status === 'cancelled') {
      return fail('ALREADY_CANCELLED', `Reservation ${reservation.code} is cancelled; make a new booking instead.`);
    }

    const partySize = change.partySize ?? reservation.partySize;
    // The reservation's own table must not block its new slot.
    const checked = this.#checkSlot(change.date, change.time, partySize, reservation.code);
    if (!checked.ok) return checked;

    const previous = { date: reservation.date, time: reservation.time, partySize: reservation.partySize };
    Object.assign(reservation, { date: change.date, time: change.time, partySize, tableSize: checked.tableSize });
    return { ok: true, reservation, previous };
  }

  list(): Reservation[] {
    return [...this.#reservations.values()];
  }

  #validateDay(date: string, partySize: number): Failure | null {
    if (!isValidDate(date)) return fail('INVALID_INPUT', `"${date}" is not a valid date (expected YYYY-MM-DD).`);
    if (!Number.isInteger(partySize) || partySize < 1) {
      return fail('INVALID_INPUT', 'Party size must be a whole number of at least 1.');
    }
    if (partySize > this.restaurant.maxPartySize) {
      return fail(
        'PARTY_TOO_LARGE',
        `Online bookings are for up to ${this.restaurant.maxPartySize} people. For larger groups, please call ${this.restaurant.phone}.`,
      );
    }
    const today = this.today();
    if (date < today.date) return fail('IN_THE_PAST', 'That date is in the past.');
    if (date > addDays(today.date, this.restaurant.bookingWindowDays)) {
      return fail('TOO_FAR_AHEAD', `Bookings open ${this.restaurant.bookingWindowDays} days in advance.`);
    }
    if (this.seatingTimes(date).length === 0) return fail('CLOSED', 'The restaurant is closed on that day.');
    return null;
  }

  #checkSlot(
    date: string,
    time: string,
    partySize: number,
    ignoreCode?: string,
  ): { ok: true; tableSize: number } | Failure {
    const invalid = this.#validateDay(date, partySize);
    if (invalid) return invalid;
    if (!isValidTime(time)) return fail('INVALID_INPUT', `"${time}" is not a valid time (expected HH:MM).`);

    const today = this.today();
    if (date === today.date && time <= today.time) return fail('IN_THE_PAST', 'That time has already passed today.');

    const alternatives = () => this.#nearestAvailable(date, time, partySize, ignoreCode);
    if (!this.seatingTimes(date).includes(time)) {
      return fail('OUTSIDE_HOURS', `We don't take bookings at ${time} on that day.`, alternatives());
    }
    const tableSize = this.#freeTable(date, time, partySize, ignoreCode);
    if (tableSize === null) return fail('FULLY_BOOKED', `No table for ${partySize} is free at ${time}.`, alternatives());
    return { ok: true, tableSize };
  }

  /** Smallest free table that fits the party for the whole seating, or null. */
  #freeTable(date: string, time: string, partySize: number, ignoreCode?: string): number | null {
    const start = toMinutes(time);
    const end = start + this.restaurant.seatingMinutes;
    const busy = [...this.#reservations.values()]
      .filter((r) => r.status === 'confirmed' && r.date === date && r.code !== ignoreCode)
      .filter((r) => toMinutes(r.time) < end && start < toMinutes(r.time) + this.restaurant.seatingMinutes)
      .map((r) => r.tableSize);

    // Remove one table of each busy size, then pick the smallest remaining table that fits.
    const free = [...this.restaurant.tables];
    for (const size of busy) {
      const index = free.indexOf(size);
      if (index !== -1) free.splice(index, 1);
    }
    const fits = free.filter((size) => size >= partySize).sort((a, b) => a - b);
    return fits[0] ?? null;
  }

  #nearestAvailable(date: string, time: string, partySize: number, ignoreCode?: string): string[] {
    const today = this.today();
    const target = toMinutes(time);
    return this.seatingTimes(date)
      .filter((t) => (date !== today.date || t > today.time) && this.#freeTable(date, t, partySize, ignoreCode) !== null)
      .sort((a, b) => Math.abs(toMinutes(a) - target) - Math.abs(toMinutes(b) - target))
      .slice(0, 3)
      .sort();
  }

  #uniqueCode(): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = this.#newCode();
      if (!this.#reservations.has(code)) return code;
    }
    throw new Error('Could not generate a unique reservation code');
  }
}
