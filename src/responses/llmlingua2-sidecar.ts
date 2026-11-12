/**
 * Optional LLMLingua-2 sidecar for ROUTED Codex compaction only.
 * No third-party source or weights are bundled. The sidecar contract is
 * POST {"text":"...","rate":0.5} -> {"compressed_text":"..."}.
 * It is opt-in and local-only; normal inference and native passthrough are untouched.
 */
import type { OcxParsedRequest, OcxMessage } from "../types";

export type CompressionSidecar = (text: string, rate: number, signal: AbortSignal) => Promise<string>;

export interface CompactionCompressionOptions {
  endpoint?: string;
  rate?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

export interface CompactionCompressionStats {
  eligible: number;
  compressed: number;
  skipped: number;
  savedChars: number;
}

/** Restrict sidecar to loopback, preventing sensitive tool logs from being sent off-host. */
export function isLocalSidecarEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost")
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Avoid touching instructions, code, JSON, filesystem paths, or exact operational evidence. */
export function eligibleForLossyCompression(text: string): boolean {
  if (text.length < 1200 || text.length > 80_000) return false;
  if (/```|<\/?(?:tool|system|developer)|\b(?:DELETE|DROP|TRUNCATE)\b/.test(text)) return false;
  if (/(?:^|\n)\s*[{[]|\b(?:sha256|commit|stack trace|traceback|error code)\b/i.test(text)) return false;
  // This sidecar targets prose tool output only, not structured tool transcripts.
  if (/[{};]/.test(text) || /(?:\/[\w.-]+){2,}/.test(text)) return false;
  return true;
}

function toolResultText(message: OcxMessage): string | null {
  if (message.role !== "toolResult") return null;
  return typeof message.content === "string" ? message.content : null;
}

export async function compressRoutedCompaction(
  parsed: OcxParsedRequest,
  options: CompactionCompressionOptions = {},
): Promise<CompactionCompressionStats> {
  const stats: CompactionCompressionStats = { eligible: 0, compressed: 0, skipped: 0, savedChars: 0 };
  if (!parsed._compactionRequest) return stats;
  const endpoint = options.endpoint ?? process.env.OPENCODEX_LLMLINGUA2_URL ?? "";
  if (!endpoint || !isLocalSidecarEndpoint(endpoint)) return stats;
  const rate = options.rate ?? Number(process.env.OPENCODEX_LLMLINGUA2_RATE ?? "0.5");
  if (!Number.isFinite(rate) || rate < 0.1 || rate > 0.9) return stats;
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 1500, 50), 5000);
  const fetcher = options.fetcher ?? fetch;
  const messages = parsed.context.messages;
  // Never compress the latest four messages, the current user's task, or any tool-call wiring.
  for (let i = 0; i < Math.max(0, messages.length - 4); i++) {
    const message = messages[i];
    const original = toolResultText(message);
    if (original === null || !eligibleForLossyCompression(original)) continue;
    stats.eligible++;
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: original, rate }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) { stats.skipped++; continue; }
      const body: unknown = await response.json();
      const compressed = body && typeof body === "object" && "compressed_text" in body
        ? (body as { compressed_text?: unknown }).compressed_text : null;
      if (typeof compressed !== "string" || compressed.trim().length < 20 || compressed.length >= original.length * 0.9) {
        stats.skipped++;
        continue;
      }
      // Do not mutate original request's _rawBody: this is routed compaction, not passthrough.
      (message as Extract<OcxMessage, { role: "toolResult" }>).content = compressed;
      stats.compressed++;
      stats.savedChars += original.length - compressed.length;
    } catch {
      // Sidecar may not be running. Preserve native compaction on every failure.
      stats.skipped++;
    }
  }
  return stats;
}
