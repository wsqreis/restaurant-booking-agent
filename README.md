# restaurant-booking-agent

[![CI](https://github.com/wsqreis/restaurant-booking-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/wsqreis/restaurant-booking-agent/actions/workflows/ci.yml)

A conversational booking assistant for a (fictional) restaurant, The Olive Table. Guests book, cancel, reschedule and check availability in plain language, in any language, over several messages, and the assistant asks only for what is still missing.

Built with **LangGraph** (TypeScript), **OpenRouter** (free models by default) and **Fastify**, with a small web chat that shows the agent's state as it works.

Illustrative exchange:

```
Guest: Can I get a table on Friday at 7:30?
Agent: Happy to help! How many people, and what name should I put the booking under?
Guest: 4 of us, Ana Silva. Do you have vegan options?
Agent: …
```

## How it works

The design principle: **the LLM understands and phrases; deterministic code decides.**

```
           ┌────────────┐   missing details / side question   ┌───────────┐
message ──▶│ understand │────────────────────────────────────▶│  respond  │──▶ reply
           │   (LLM)    │                                      │   (LLM)   │
           └─────┬──────┘                                      └─────▲─────┘
                 │ intent + all required details                     │ outcome
                 ▼                                                   │
           ┌────────────┐                                            │
           │    act     │──── ReservationService (no LLM) ───────────┘
           └────────────┘
```

1. **understand**: one structured-output call turns the conversation into an intent (`book`, `cancel`, `reschedule`, `check_availability`, `restaurant_info`, `other`) and booking details. Relative dates ("this Saturday", "tomorrow") are resolved against the restaurant's local date and time. Details accumulate across turns in the graph state.
2. **act**: runs only when every required detail is present. `ReservationService` owns all business rules: opening hours, the 30-minute slot grid, a 2-hour seating, table assignment (the smallest table that fits), the booking window and group size limits. When a slot fails, it returns the nearest bookable times.
3. **respond**: writes the reply from a JSON "situation" (missing fields, or the service outcome). The prompt forbids inventing availability, codes or menu items, so confirmation codes and times always come from the service.

Conversation details that matter in practice:

- **Slot filling across turns.** "4 of us" is understood as an answer to the booking in progress, not a new request.
- **Side questions don't lose progress.** Asking "do you have parking?" halfway through a booking answers the question and keeps the collected details.
- **Failures keep the request open.** After "we're closed on Monday, how about Friday?", the guest can just say "Friday then".
- **Requests close after success**, so the next message starts fresh.
- **Per-conversation memory** via a LangGraph checkpointer keyed by `threadId`.

## Evaluation

`npm run eval` runs 24 cases against a real model and scores **how well it understands guests**: the intent of each message, the request in progress, and every booking detail. The cases include relative dates, "half seven in the evening", corrections ("make it 8:30"), side questions mid-booking, lowercase codes, and messages in Portuguese and Spanish. The clock is frozen, so every case has exactly one right answer.

```bash
npm run eval                                                   # the configured model chain
npm run eval -- --models nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free   # each model on its own
```

It prints pass/fail per case, per-field accuracy and average latency, and saves full results to `eval/results/`.

<!-- Results table: run `npm run eval` per model and paste the summary here. -->

## Run it

Requires Node.js 22.18+ and a free [OpenRouter API key](https://openrouter.ai/keys).

```bash
npm install
cp .env.example .env    # add OPENROUTER_API_KEY
npm run dev             # http://127.0.0.1:3000
```

The page has a chat on the left, and on the right the agent's state for the last turn plus the reservation book, so you can see what the agent actually did.

### API

`POST /api/chat`

```json
{ "message": "Table for 2 on Saturday at 8pm", "threadId": "optional-uuid-from-previous-response" }
```

Returns `{ threadId, reply, debug: { intent, details, missing, outcome } }`. `GET /api/reservations` lists the reservation book.

## Tests

```bash
npm test          # no network: domain rules, graph behaviour with a scripted model, HTTP API
npm run typecheck
```

The graph tests replace the LLM with a scripted model, so they pin down the conversation logic (slot filling, side questions, failures, request switching) deterministically. The domain tests use a frozen clock.

## Project layout

```
src/
├── agent/         # LangGraph state, nodes, routing and prompts
├── domain/        # ReservationService, restaurant config, date/time helpers
├── llm/           # ChatModel interface + OpenRouter implementation (fallback models)
├── server.ts      # Fastify API + demo page
└── index.ts
eval/              # cases.json + runner
public/index.html  # demo chat UI
```

## Notes and limits

- Reservations live in memory; restart the server and the book is empty. The service is a single class behind a narrow API, so swapping in SQLite or Postgres touches one file.
- Free OpenRouter models change often and are rate limited. Set `OPENROUTER_MODELS` to whatever is available; the second and later entries are used as fallbacks.
- There is no authentication: guests are identified only by their reservation code, as on most restaurant booking pages.

## License

[MIT](LICENSE)
