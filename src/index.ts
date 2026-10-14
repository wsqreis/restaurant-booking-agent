import { MemorySaver } from '@langchain/langgraph';
import { buildAgent } from './agent/graph.ts';
import { loadConfig } from './config.ts';
import { ReservationService } from './domain/reservations.ts';
import { OLIVE_TABLE } from './domain/restaurant.ts';
import { OpenRouterModel } from './llm/model.ts';
import { buildApp } from './server.ts';

const config = loadConfig();
if (!config.llm.apiKey) {
  console.error('OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const reservations = new ReservationService(OLIVE_TABLE);
const agent = buildAgent(new OpenRouterModel(config.llm), reservations, new MemorySaver());
const app = buildApp({ agent, reservations });

await app.listen({ port: config.port, host: config.host });
