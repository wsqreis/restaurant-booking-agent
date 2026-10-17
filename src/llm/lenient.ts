import { z } from 'zod';

/**
 * Models, especially small free ones, often fill structured output with "None", "null" or "N/A" strings where the
 * schema says null, and send numbers as strings ("4"). Strict validation then rejects the whole answer.
 * `lenient` repairs exactly those two cases, guided by the schema, before validating.
 */
export const NULL_LIKE = /^\s*(none|null|nil|n\/a|na|unknown|not provided|not specified|-)?\s*$/i;

export const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === 'string' && NULL_LIKE.test(value));

/** Strips nullable/optional/default wrappers to reach the type that matters. */
function core(schema: z.ZodType | undefined): z.ZodType | undefined {
  let current = schema;
  for (let i = 0; i < 10 && current; i++) {
    if (current instanceof z.ZodNullable || current instanceof z.ZodOptional) current = current.unwrap() as z.ZodType;
    else if (current instanceof z.ZodDefault) current = current.def.innerType as z.ZodType;
    else break;
  }
  return current;
}

export function lenient(schema: z.ZodType | undefined, value: unknown): unknown {
  const type = core(schema);
  if (typeof value === 'string' && NULL_LIKE.test(value) && !(type instanceof z.ZodEnum)) return null;
  if (Array.isArray(value)) {
    const element = type instanceof z.ZodArray ? (type.element as z.ZodType) : undefined;
    return value.map((item) => lenient(element, item));
  }
  if (value !== null && typeof value === 'object') {
    const shape = type instanceof z.ZodObject ? (type.shape as Record<string, z.ZodType>) : {};
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, lenient(shape[key], inner)]));
  }
  if (typeof value === 'string' && type instanceof z.ZodNumber && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
    return Number(value);
  }
  return value;
}
