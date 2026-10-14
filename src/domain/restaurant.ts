/** Static description of the (fictional) restaurant the agent takes bookings for. */
export type Restaurant = {
  name: string;
  timeZone: string;
  address: string;
  phone: string;
  /** Opening periods per weekday (0 = Sunday). Times are "HH:MM", local time. */
  openingHours: Record<number, Array<{ open: string; close: string }>>;
  /** Minutes a party occupies a table. */
  seatingMinutes: number;
  /** Bookings start on this grid, e.g. every 30 minutes. */
  slotMinutes: number;
  /** Last booking is this long before closing. */
  lastSeatingBeforeCloseMinutes: number;
  tables: number[];
  maxPartySize: number;
  bookingWindowDays: number;
};

const lunch = { open: '12:00', close: '15:00' };
const dinner = { open: '18:00', close: '22:30' };

export const OLIVE_TABLE: Restaurant = {
  name: 'The Olive Table',
  timeZone: 'Europe/London',
  address: '12 Market Lane, London',
  phone: '+44 20 7946 0000',
  openingHours: {
    0: [lunch], // Sunday: lunch only
    1: [], // Monday: closed
    2: [lunch, dinner],
    3: [lunch, dinner],
    4: [lunch, dinner],
    5: [lunch, dinner],
    6: [lunch, dinner],
  },
  seatingMinutes: 120,
  slotMinutes: 30,
  lastSeatingBeforeCloseMinutes: 60,
  tables: [2, 2, 2, 2, 4, 4, 4, 6, 8],
  maxPartySize: 8,
  bookingWindowDays: 60,
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Human-readable opening hours, used in prompts and answers. */
export function describeOpeningHours(restaurant: Restaurant): string {
  return WEEKDAYS.map((day, index) => {
    const periods = restaurant.openingHours[index] ?? [];
    const text = periods.length ? periods.map((p) => `${p.open}-${p.close}`).join(' and ') : 'closed';
    return `${day}: ${text}`;
  }).join('; ');
}
