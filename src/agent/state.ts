import { type BaseMessage } from '@langchain/core/messages';
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { z } from 'zod';

export const INTENTS = ['book', 'cancel', 'reschedule', 'check_availability', 'restaurant_info', 'other'] as const;
export type Intent = (typeof INTENTS)[number];

/** What the guest has told us so far for the request in progress. Survives across turns. */
export const bookingDetails = z.object({
  name: z.string().nullable(),
  partySize: z.number().int().nullable(),
  date: z.string().nullable().describe('YYYY-MM-DD'),
  time: z.string().nullable().describe('HH:MM, 24h'),
  reservationCode: z.string().nullable(),
  notes: z.string().nullable().describe('Dietary needs, occasion, seating preferences'),
});
export type BookingDetails = z.infer<typeof bookingDetails>;

export const EMPTY_DETAILS: BookingDetails = {
  name: null,
  partySize: null,
  date: null,
  time: null,
  reservationCode: null,
  notes: null,
};

/** Fields each intent needs before the agent can act. */
export const REQUIRED: Record<Intent, Array<keyof BookingDetails>> = {
  book: ['date', 'time', 'partySize', 'name'],
  cancel: ['reservationCode'],
  reschedule: ['reservationCode', 'date', 'time'],
  check_availability: ['date'],
  restaurant_info: [],
  other: [],
};

/** The result of the action taken this turn, which the reply must be based on. */
export type Outcome = {
  action: Exclude<Intent, 'restaurant_info' | 'other'>;
  ok: boolean;
  data: Record<string, unknown>;
};

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  /** Intent of the request in progress; kept while we collect missing details. */
  intent: Annotation<Intent | null>({ reducer: (_, next) => next, default: () => null }),
  /** What this message is about. Differs from `intent` for side questions mid-request. */
  turn: Annotation<Intent | null>({ reducer: (_, next) => next, default: () => null }),
  details: Annotation<BookingDetails>({ reducer: (_, next) => next, default: () => EMPTY_DETAILS }),
  missing: Annotation<Array<keyof BookingDetails>>({ reducer: (_, next) => next, default: () => [] }),
  outcome: Annotation<Outcome | null>({ reducer: (_, next) => next, default: () => null }),
});

export type State = typeof AgentState.State;
export type StateUpdate = typeof AgentState.Update;
