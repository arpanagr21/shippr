import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Parses a raw Coolify/API error string into a code + human message. */
export function parseApiError(raw: string): { code?: string; message: string } {
  const cleaned   = raw.replace(/^Error:\s*/, '');
  const codeMatch = cleaned.match(/\b(\d{3})\b/);
  const jsonMatch = cleaned.match(/:\s*(\{.*\})\s*$/);
  const code      = codeMatch?.[1];

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as { message?: string };
      if (parsed.message) return { code, message: parsed.message };
    } catch { /* fall through */ }
  }

  const stripped = cleaned.replace(/^Coolify API \d+ on [^:]+:\s*/, '').trim();
  return { code, message: stripped || cleaned };
}
