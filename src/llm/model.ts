import type { AIMessage, BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import type { z } from 'zod';
import type { Config } from '../config.ts';
import { lenient } from './lenient.ts';

/**
 * The two things the agent needs from an LLM. Keeping it this small lets tests
 * swap in a scripted fake, and lets the provider change without touching the graph.
 */
export interface ChatModel {
  extract<T extends z.ZodObject>(schema: T, messages: BaseMessage[]): Promise<z.infer<T>>;
  reply(messages: BaseMessage[]): Promise<string>;
}

/**
 * True when another model might succeed: the model or its provider is missing, overloaded, rate limited or down.
 * Not for bad requests or bad keys, which would fail the same way on every model.
 */
export function isProviderFailure(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return status === 404 || status === 408 || status === 429 || status >= 500;
  const name = error instanceof Error ? error.name : '';
  return /Timeout|Connection|Abort/i.test(name);
}

/** OpenRouter through its OpenAI-compatible API, trying the configured models in order. */
export class OpenRouterModel implements ChatModel {
  readonly #chats: ChatOpenAI[];

  constructor(config: Config['llm']) {
    // One client per model, tried in order here rather than with OpenRouter's `models` routing:
    // during a provider outage that answered 404, OpenRouter rarely moved on to the next model.
    this.#chats = config.models.map(
      (model) =>
        new ChatOpenAI({
          model,
          apiKey: config.apiKey,
          temperature: config.temperature,
          timeout: config.timeoutMs,
          maxRetries: 2,
          configuration: {
            baseURL: config.baseUrl,
            defaultHeaders: { 'HTTP-Referer': config.appUrl, 'X-Title': config.appName },
          },
        }),
    );
  }

  async #firstAvailable<R>(call: (chat: ChatOpenAI) => Promise<R>): Promise<R> {
    let lastError: unknown;
    for (const chat of this.#chats) {
      try {
        return await call(chat);
      } catch (error) {
        if (!isProviderFailure(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  async extract<T extends z.ZodObject>(schema: T, messages: BaseMessage[]): Promise<z.infer<T>> {
    // Function calling is supported by far more (free) models than native JSON schema output.
    // includeRaw keeps the model's own arguments, so they can be repaired (see lenient) instead of rejected.
    const { raw } = await this.#firstAvailable((chat) =>
      chat.withStructuredOutput(schema, { method: 'functionCalling', name: 'extract', includeRaw: true }).invoke(messages),
    );
    const args = (raw as AIMessage).tool_calls?.[0]?.args;
    if (!args) throw new Error('The model did not return structured output');
    return schema.parse(lenient(schema, args)) as z.infer<T>;
  }

  async reply(messages: BaseMessage[]): Promise<string> {
    const response = await this.#firstAvailable((chat) => chat.invoke(messages));
    return typeof response.content === 'string'
      ? response.content
      : response.content.map((part) => ('text' in part ? part.text : '')).join('');
  }
}
