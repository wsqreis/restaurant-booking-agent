import type { BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import type { z } from 'zod';
import type { Config } from '../config.ts';

/**
 * The two things the agent needs from an LLM. Keeping it this small lets tests
 * swap in a scripted fake, and lets the provider change without touching the graph.
 */
export interface ChatModel {
  extract<T extends z.ZodObject>(schema: T, messages: BaseMessage[]): Promise<z.infer<T>>;
  reply(messages: BaseMessage[]): Promise<string>;
}

/** OpenRouter through its OpenAI-compatible API, with a list of fallback models. */
export class OpenRouterModel implements ChatModel {
  readonly #chat: ChatOpenAI;

  constructor(config: Config['llm']) {
    const [primary, ...fallbacks] = config.models;
    this.#chat = new ChatOpenAI({
      model: primary,
      apiKey: config.apiKey,
      temperature: config.temperature,
      timeout: config.timeoutMs,
      maxRetries: 2,
      configuration: {
        baseURL: config.baseUrl,
        defaultHeaders: { 'HTTP-Referer': config.appUrl, 'X-Title': config.appName },
      },
      // OpenRouter tries these in order when the primary model is down or rate limited.
      modelKwargs: fallbacks.length ? { models: config.models } : {},
    });
  }

  async extract<T extends z.ZodObject>(schema: T, messages: BaseMessage[]): Promise<z.infer<T>> {
    // Function calling is supported by far more (free) models than native JSON schema output.
    const structured = this.#chat.withStructuredOutput(schema, { method: 'functionCalling', name: 'extract' });
    return (await structured.invoke(messages)) as z.infer<T>;
  }

  async reply(messages: BaseMessage[]): Promise<string> {
    const response = await this.#chat.invoke(messages);
    return typeof response.content === 'string'
      ? response.content
      : response.content.map((part) => ('text' in part ? part.text : '')).join('');
  }
}
