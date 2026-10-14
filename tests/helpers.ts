import { type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { buildAgent } from '../src/agent/graph.ts';
import { type BookingDetails, EMPTY_DETAILS, type Intent } from '../src/agent/state.ts';
import { ReservationService } from '../src/domain/reservations.ts';
import { OLIVE_TABLE } from '../src/domain/restaurant.ts';
import type { ChatModel } from '../src/llm/model.ts';

// Wednesday 14 October 2026, 11:00 in London (10:00 UTC, British Summer Time).
export const NOW = new Date('2026-10-14T10:00:00Z');
export const TODAY = '2026-10-14';
export const FRIDAY = '2026-10-16';
export const MONDAY = '2026-10-19';

export function service() {
  let next = 0;
  const codes = ['ABC234', 'DEF567', 'GHJ892', 'KLM345', 'NPQ678'];
  return new ReservationService(OLIVE_TABLE, { now: () => NOW, newCode: () => codes[next++ % codes.length]! });
}

export type Extraction = { intent: Intent } & Partial<BookingDetails>;

/** A ChatModel that returns scripted extractions and records what it was asked. */
export class ScriptedModel implements ChatModel {
  readonly extractions: Extraction[] = [];
  readonly replyPrompts: string[] = [];
  failWith: Error | null = null;

  say(...extractions: Extraction[]): this {
    this.extractions.push(...extractions);
    return this;
  }

  async extract(): Promise<never> {
    if (this.failWith) throw this.failWith;
    const next = this.extractions.shift();
    if (!next) throw new Error('ScriptedModel: no extraction left in the script');
    return { ...EMPTY_DETAILS, ...next } as never;
  }

  async reply(messages: BaseMessage[]): Promise<string> {
    this.replyPrompts.push(String(messages[0]?.content));
    return `reply #${this.replyPrompts.length}`;
  }
}

export function agentWith(model: ChatModel, reservations = service()) {
  const agent = buildAgent(model, reservations, new MemorySaver());
  let turn = 0;
  const thread = { configurable: { thread_id: `t-${Math.random()}` } };
  return {
    reservations,
    agent,
    send: (text: string) => {
      turn++;
      return agent.invoke({ messages: [new HumanMessage({ content: text, id: `m${turn}` })] }, thread);
    },
  };
}
