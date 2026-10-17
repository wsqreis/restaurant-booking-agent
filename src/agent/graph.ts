import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { type BaseCheckpointSaver, END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import type { ReservationService } from '../domain/reservations.ts';
import { isBlank } from '../llm/lenient.ts';
import type { ChatModel } from '../llm/model.ts';
import { replyPrompt, understandPrompt } from './prompts.ts';
import {
  AgentState,
  bookingDetails,
  EMPTY_DETAILS,
  INTENTS,
  type Outcome,
  REQUIRED,
  type State,
  type StateUpdate,
} from './state.ts';

const extraction = bookingDetails.extend({
  intent: z.enum(INTENTS).describe('What the guest wants right now'),
});

/** How many past messages the extractor sees; older turns are already summarised in `details`. */
const HISTORY_WINDOW = 8;

export function buildAgent(model: ChatModel, reservations: ReservationService, checkpointer?: BaseCheckpointSaver) {
  const today = () => reservations.today();

  /** LLM step 1: turn the guest's message into an intent and booking details. */
  async function understand(state: State): Promise<StateUpdate> {
    const extracted = await model.extract(extraction, [
      new SystemMessage(understandPrompt(reservations.restaurant, today(), state)),
      ...state.messages.slice(-HISTORY_WINDOW),
    ]);
    const { intent: said, ...fields } = extracted;

    const inProgress = state.intent;
    // A bare answer ("4 people") comes back as "other"; it continues the request in progress.
    const turn = said === 'other' && inProgress ? inProgress : said;
    // A side question ("do you have parking?") must not abandon a half-finished booking.
    const sideQuestion = turn === 'restaurant_info' || turn === 'other';
    const intent = sideQuestion && inProgress ? inProgress : turn;
    // Starting a different request drops the details of the previous one.
    const carried = intent === inProgress ? state.details : EMPTY_DETAILS;
    const details = { ...carried };
    for (const [key, value] of Object.entries(fields) as Array<[keyof typeof details, never]>) {
      if (!isBlank(value)) details[key] = value;
    }
    if (details.reservationCode) details.reservationCode = details.reservationCode.toUpperCase();

    const missing = REQUIRED[intent].filter((field) => details[field] === null);
    return { intent, turn, details, missing, outcome: null };
  }

  /** Deterministic step: the reservation service, not the LLM, decides what is possible. */
  function act(state: State): StateUpdate {
    const { details } = state;
    let outcome: Outcome;
    switch (state.intent) {
      case 'book': {
        const result = reservations.book({
          name: details.name!,
          partySize: details.partySize!,
          date: details.date!,
          time: details.time!,
          notes: details.notes,
        });
        outcome = { action: 'book', ok: result.ok, data: result };
        break;
      }
      case 'cancel': {
        const result = reservations.cancel(details.reservationCode!);
        outcome = { action: 'cancel', ok: result.ok, data: result };
        break;
      }
      case 'reschedule': {
        const result = reservations.reschedule(details.reservationCode!, {
          date: details.date!,
          time: details.time!,
          ...(details.partySize ? { partySize: details.partySize } : {}),
        });
        outcome = { action: 'reschedule', ok: result.ok, data: result };
        break;
      }
      case 'check_availability': {
        const result = reservations.availability(details.date!, details.partySize ?? 2);
        outcome = { action: 'check_availability', ok: result.ok, data: result };
        break;
      }
      default:
        throw new Error(`act() called with non-actionable intent ${state.intent}`);
    }
    return { outcome };
  }

  /** LLM step 2: phrase the reply from the outcome. It may not add facts of its own. */
  async function respond(state: State): Promise<StateUpdate> {
    const text = await model.reply([
      new SystemMessage(
        replyPrompt(reservations.restaurant, today(), {
          turn: state.turn,
          intent: state.intent,
          details: state.details,
          missing: state.missing,
          outcome: state.outcome,
        }),
      ),
      ...state.messages.slice(-HISTORY_WINDOW),
    ]);

    const update: StateUpdate = { messages: [new AIMessage(text)] };
    // A completed booking, cancellation or reschedule closes the request. A failed one stays
    // open, so the guest can just say "8pm then" after we offer alternatives.
    const done = state.outcome?.ok && state.outcome.action !== 'check_availability';
    const nothingInProgress = state.intent === 'restaurant_info' || state.intent === 'other';
    if (done || nothingInProgress) Object.assign(update, { intent: null, details: EMPTY_DETAILS });
    return update;
  }

  const route = (state: State) =>
    state.turn === state.intent && state.intent && state.missing.length === 0 && REQUIRED[state.intent].length > 0
      ? 'act'
      : 'respond';

  return new StateGraph(AgentState)
    .addNode('understand', understand)
    .addNode('act', act)
    .addNode('respond', respond)
    .addEdge(START, 'understand')
    .addConditionalEdges('understand', route, ['act', 'respond'])
    .addEdge('act', 'respond')
    .addEdge('respond', END)
    .compile({ checkpointer });
}

export type Agent = ReturnType<typeof buildAgent>;
