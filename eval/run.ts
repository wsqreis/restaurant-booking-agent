// Measures how well a model understands guests: intent and booking details, case by case.
//
//   npm run eval                                  # default model list from config
//   npm run eval -- --models a/model:free,b/model  # compare several models
//   npm run eval -- --only case-a,case-b           # a subset of cases
//
// The clock is frozen at Wednesday 14 Oct 2026, 11:00 London, so relative dates
// ("tomorrow", "this Saturday") have one right answer. Replies are stubbed out:
// only the understanding step calls the LLM.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { buildAgent } from '../src/agent/graph.ts';
import type { BookingDetails, Intent } from '../src/agent/state.ts';
import { loadConfig } from '../src/config.ts';
import { ReservationService } from '../src/domain/reservations.ts';
import { OLIVE_TABLE } from '../src/domain/restaurant.ts';
import { type ChatModel, OpenRouterModel } from '../src/llm/model.ts';

type Case = {
  id: string;
  history?: string[];
  message: string;
  expect: { turn: Intent; intent?: Intent; details?: Partial<BookingDetails>; notesInclude?: string };
};

const NOW = new Date('2026-10-14T10:00:00Z');
const PAUSE_MS = 1500; // free models are rate limited

const config = loadConfig();
if (!config.llm.apiKey) {
  console.error('Set OPENROUTER_API_KEY in .env first.');
  process.exit(1);
}
const flag = process.argv.indexOf('--models');
const models = flag > -1 ? (process.argv[flag + 1] ?? '').split(',').filter(Boolean) : [config.llm.models.join(',')];
const allCases: Case[] = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
// --only id1,id2 re-runs a subset of cases
const onlyFlag = process.argv.indexOf('--only');
const only = onlyFlag > -1 ? new Set((process.argv[onlyFlag + 1] ?? '').split(',')) : null;
const cases = only ? allCases.filter((c) => only.has(c.id)) : allCases;

/** Real extraction, stubbed reply: the eval only scores understanding. */
class UnderstandingOnly implements ChatModel {
  readonly #inner: ChatModel;
  constructor(inner: ChatModel) {
    this.#inner = inner;
  }
  extract: ChatModel['extract'] = (schema, messages) => this.#inner.extract(schema, messages);
  async reply() {
    return '(reply skipped in eval)';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCase(model: ChatModel, testCase: Case) {
  // A fresh, empty restaurant per case, so earlier cases can't change outcomes.
  const reservations = new ReservationService(OLIVE_TABLE, { now: () => NOW });
  const agent = buildAgent(model, reservations, new MemorySaver());
  const thread = { configurable: { thread_id: testCase.id } };
  for (const message of testCase.history ?? []) {
    await agent.invoke({ messages: [new HumanMessage(message)] }, thread);
    await sleep(PAUSE_MS);
  }
  const started = performance.now();
  // Score what the understanding step produced: after a successful booking the final state is reset for the
  // next request, so reading it would show empty details for exactly the cases the agent got right.
  let understood: { turn: Intent | null; intent: Intent | null; details: BookingDetails } | undefined;
  for await (const update of await agent.stream({ messages: [new HumanMessage(testCase.message)] }, { ...thread, streamMode: 'updates' })) {
    if ('understand' in update) understood = update.understand as typeof understood;
  }
  const latencyMs = performance.now() - started;
  if (!understood) throw new Error('the understand step produced no output');
  const state = understood;

  const checks: Record<string, { expected: unknown; actual: unknown }> = {
    turn: { expected: testCase.expect.turn, actual: state.turn },
  };
  if (testCase.expect.intent) checks.intent = { expected: testCase.expect.intent, actual: state.intent };
  for (const [field, expected] of Object.entries(testCase.expect.details ?? {})) {
    const actual = state.details[field as keyof BookingDetails];
    checks[field] = {
      expected,
      actual: typeof actual === 'string' && field === 'name' ? actual.trim() : actual,
    };
  }
  if (testCase.expect.notesInclude) {
    const notes = state.details.notes ?? '';
    checks.notes = {
      expected: `contains "${testCase.expect.notesInclude}"`,
      actual: notes.toLowerCase().includes(testCase.expect.notesInclude) ? `contains "${testCase.expect.notesInclude}"` : notes,
    };
  }
  const failed = Object.entries(checks).filter(([, check]) => check.expected !== check.actual);
  return { id: testCase.id, passed: failed.length === 0, checks, failed: Object.fromEntries(failed), latencyMs };
}

const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '-');

await mkdir(new URL('./results/', import.meta.url), { recursive: true });

for (const modelList of models) {
  const model = new UnderstandingOnly(new OpenRouterModel({ ...config.llm, models: modelList.split(',') }));
  const label = modelList.split(',')[0]!;
  console.log(`\n== ${label}${modelList.includes(',') ? ' (with fallbacks)' : ''}`);

  const results = [];
  for (const testCase of cases) {
    try {
      const result = await runCase(model, testCase);
      results.push(result);
      console.log(`${result.passed ? 'pass' : 'FAIL'}  ${testCase.id}${result.passed ? '' : `  ${JSON.stringify(result.failed)}`}`);
    } catch (error) {
      results.push({ id: testCase.id, passed: false, checks: {}, failed: { error: String(error) }, latencyMs: 0 });
      console.log(`ERR   ${testCase.id}  ${error instanceof Error ? error.message : error}`);
    }
    await sleep(PAUSE_MS);
  }

  // Per-field accuracy across every case that checks that field.
  const fields = new Map<string, { right: number; total: number }>();
  for (const result of results) {
    for (const [field, check] of Object.entries(result.checks)) {
      const score = fields.get(field) ?? { right: 0, total: 0 };
      score.total++;
      if (check.expected === check.actual) score.right++;
      fields.set(field, score);
    }
  }
  const passed = results.filter((result) => result.passed).length;
  const timed = results.filter((result) => result.latencyMs > 0);
  const avgLatency = timed.reduce((sum, result) => sum + result.latencyMs, 0) / (timed.length || 1);

  console.log(`\ncases passed: ${passed}/${results.length} (${pct(passed, results.length)})`);
  console.log(`avg latency:  ${(avgLatency / 1000).toFixed(1)}s per message`);
  for (const [field, score] of fields) console.log(`  ${field.padEnd(16)} ${pct(score.right, score.total).padStart(4)}  (${score.right}/${score.total})`);

  const file = new URL(`./results/${label.replace(/[^\w.-]+/g, '_')}-${Date.now()}.json`, import.meta.url);
  await writeFile(file, JSON.stringify({ model: modelList, ranAt: new Date().toISOString(), passed, total: results.length, avgLatency, results }, null, 2));
}
