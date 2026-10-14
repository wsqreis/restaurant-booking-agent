// Dates are "YYYY-MM-DD" and times "HH:MM" in the restaurant's local time zone.
// Keeping them as plain strings avoids time zone bugs: only "now" needs a zone.

export const toMinutes = (time: string): number => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export const fromMinutes = (total: number): string =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/** Local date and time of an instant in a given IANA time zone. */
export function localNow(instant: Date, timeZone: string): { date: string; time: string; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, weekday: weekdayOf(date) };
}

/** Day of week (0 = Sunday) of a calendar date, independent of time zones. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

export const addDays = (date: string, days: number): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

export const isValidDate = (date: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);

export const isValidTime = (time: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

export const formatDate = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
