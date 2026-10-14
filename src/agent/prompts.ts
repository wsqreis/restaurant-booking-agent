import { describeOpeningHours, type Restaurant } from '../domain/restaurant.ts';
import { formatDate } from '../domain/time.ts';
import type { BookingDetails, Intent, Outcome } from './state.ts';

type Today = { date: string; time: string };

const restaurantFacts = (restaurant: Restaurant) =>
  `Restaurant: ${restaurant.name}, ${restaurant.address}. Phone: ${restaurant.phone}.
Opening hours: ${describeOpeningHours(restaurant)}.
Online bookings: parties of 1-${restaurant.maxPartySize}, up to ${restaurant.bookingWindowDays} days ahead, last seating ${restaurant.lastSeatingBeforeCloseMinutes} minutes before closing.`;

export function understandPrompt(
  restaurant: Restaurant,
  today: Today,
  current: { intent: Intent | null; details: BookingDetails },
): string {
  return `You extract structured booking information from a conversation with a restaurant guest.

Today is ${formatDate(today.date)} (${today.date}), current local time ${today.time}.
${restaurantFacts(restaurant)}

Request in progress: ${current.intent ?? 'none'}
Details collected so far: ${JSON.stringify(current.details)}

Rules:
- intent is what the guest wants now: book a new table, cancel, reschedule an existing booking, check_availability, ask about the restaurant (restaurant_info), or other.
- If the guest is only answering a question about the request in progress (e.g. "4 people", "at 8"), keep that request's intent.
- Fill a field only if the guest stated it in the conversation; otherwise null. Never guess a name or a party size.
- Resolve relative dates ("tomorrow", "next Friday", "this Saturday") against today's date into YYYY-MM-DD.
- Times are 24h HH:MM: "8pm" -> "20:00", "half seven in the evening" -> "19:30", "noon" -> "12:00".
- reservationCode: the 6-character code from an existing booking, uppercase.
- notes: allergies, dietary needs, occasions or seating preferences, if mentioned.
- If the guest corrects a detail, return the corrected value.`;
}

export function replyPrompt(
  restaurant: Restaurant,
  today: Today,
  situation: {
    turn: Intent | null;
    intent: Intent | null;
    details: BookingDetails;
    missing: Array<keyof BookingDetails>;
    outcome: Outcome | null;
  },
): string {
  return `You are the friendly booking assistant of ${restaurant.name}. Write the next reply to the guest.

Today is ${formatDate(today.date)} (${today.date}), current local time ${today.time}.
${restaurantFacts(restaurant)}

Situation (the source of truth for this reply):
${JSON.stringify(situation, null, 2)}

"turn" is what the guest's last message is about; "intent" is the request in progress.

Rules:
- If the guest asked a side question (turn is restaurant_info or other), answer it first.
- If "missing" is not empty, ask for exactly those details, all in one short question.
- If "outcome" is present, base the reply on it. On success, confirm the details from the outcome and give the reservation code exactly as written.
  On failure, explain the problem in plain words and offer the alternative times listed there, if any.
- Never invent availability, times, reservation codes, prices or menu items. If something is not in the situation or the facts above, say you don't know and suggest calling ${restaurant.phone}.
- For questions about the restaurant, answer only from the facts above.
- Write dates like "Friday 14 November" and times like "7:30 pm".
- Be concise: at most 3 short sentences. Reply in the same language the guest is using.`;
}
