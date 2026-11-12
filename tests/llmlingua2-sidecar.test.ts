import { expect, test } from "bun:test";
import { compressRoutedCompaction, eligibleForLossyCompression, isLocalSidecarEndpoint } from "../src/responses/llmlingua2-sidecar";
import type { OcxParsedRequest } from "../src/types";

const prose = "A historical project discussion described background context and prior alternatives in ordinary language. ".repeat(24);
function request(): OcxParsedRequest {
  return {
    modelId: "routed/model",
    _compactionRequest: true,
    stream: false,
    options: {},
    context: { messages: [
      { role: "toolResult", toolCallId: "call-1", toolName: "search", content: prose, isError: false, timestamp: 1 },
      { role: "user", content: "Keep the requirements intact.", timestamp: 2 },
      { role: "assistant", content: [{ type: "text", text: "Working." }], timestamp: 3 },
      { role: "toolResult", toolCallId: "call-2", toolName: "shell", content: "EXACT 123", isError: false, timestamp: 4 },
      { role: "user", content: "Continue", timestamp: 5 },
    ] },
  };
}

test("only explicit loopback HTTP sidecars are accepted", () => {
  expect(isLocalSidecarEndpoint("http://127.0.0.1:9009/compress")).toBe(true);
  expect(isLocalSidecarEndpoint("http://localhost:9009/compress")).toBe(true);
  expect(isLocalSidecarEndpoint("https://example.com/compress")).toBe(false);
  expect(isLocalSidecarEndpoint("http://192.168.0.5/compress")).toBe(false);
  expect(isLocalSidecarEndpoint("http://user:pass@localhost:9009")).toBe(false);
});

test("code and exact evidence are excluded", () => {
  expect(eligibleForLossyCompression(prose)).toBe(true);
  expect(eligibleForLossyCompression(prose + "\n```rust\nfn main() {}\n```")).toBe(false);
  expect(eligibleForLossyCompression(prose + "\ncommit 0123")).toBe(false);
});

test("compresses only old eligible tool prose and preserves request wiring", async () => {
  const req = request();
  const compact = "Historical discussion of project alternatives and their broad background.";
  const stats = await compressRoutedCompaction(req, {
    endpoint: "http://localhost:9009/compress",
    fetcher: async () => new Response(JSON.stringify({ compressed_text: compact }), { status: 200 }),
  });
  expect(stats.compressed).toBe(1);
  expect(stats.savedChars).toBe(prose.length - compact.length);
  expect(req.context.messages[0].role).toBe("toolResult");
  expect((req.context.messages[0] as { content: string }).content).toBe(compact);
  expect((req.context.messages[3] as { content: string }).content).toBe("EXACT 123");
});

test("missing sidecar, invalid response or ordinary turns leave context intact", async () => {
  for (const httpResult of [new Response("bad", { status: 500 }), new Response('{"compressed_text":"x"}')]) {
    const req = request();
    const stats = await compressRoutedCompaction(req, {
      endpoint: "http://localhost:9009/compress",
      fetcher: async () => httpResult,
    });
    expect(stats.compressed).toBe(0);
    expect((req.context.messages[0] as { content: string }).content).toBe(prose);
  }
  const req = request();
  req._compactionRequest = false;
  const stats = await compressRoutedCompaction(req, { endpoint: "http://localhost:9009/compress" });
  expect(stats.eligible).toBe(0);
});
