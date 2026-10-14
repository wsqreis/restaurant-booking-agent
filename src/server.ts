import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HumanMessage } from '@langchain/core/messages';
import Fastify from 'fastify';
import type { Agent } from './agent/graph.ts';
import type { ReservationService } from './domain/reservations.ts';

const chatBody = {
  type: 'object',
  required: ['message'],
  additionalProperties: false,
  properties: {
    message: { type: 'string', minLength: 1, maxLength: 1000 },
    threadId: { type: 'string', format: 'uuid' },
  },
} as const;

export function buildApp({ agent, reservations }: { agent: Agent; reservations: ReservationService }) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/', async (_, reply) => {
    const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
    return reply.type('text/html').send(html);
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.post<{ Body: { message: string; threadId?: string } }>(
    '/api/chat',
    { schema: { body: chatBody } },
    async (request) => {
      // One thread per conversation; LangGraph's checkpointer keeps its state between requests.
      const threadId = request.body.threadId ?? randomUUID();
      const state = await agent.invoke(
        { messages: [new HumanMessage(request.body.message)] },
        { configurable: { thread_id: threadId } },
      );
      const last = state.messages.at(-1);
      return {
        threadId,
        reply: typeof last?.content === 'string' ? last.content : '',
        // Exposed for the demo UI's "under the hood" panel.
        debug: { intent: state.intent, details: state.details, missing: state.missing, outcome: state.outcome },
      };
    },
  );

  // Read-only view of the booking book, so the demo can show what the agent actually did.
  app.get('/api/reservations', async () => ({ today: reservations.today(), reservations: reservations.list() }));

  app.setErrorHandler((error, request, reply) => {
    if ((error as { validation?: unknown }).validation) {
      return reply.status(400).send({ error: (error as Error).message });
    }
    request.log.error(error);
    return reply.status(502).send({ error: 'The assistant is unavailable right now. Please try again in a moment.' });
  });

  return app;
}
