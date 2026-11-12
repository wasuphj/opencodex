# LLMLingua-2 optional compaction sidecar

Status: **adapter integrated, disabled by default**. This repository **does not bundle or run**
the LLMLingua-2 model. An external operator-managed local server must implement the contract.

## Scope and boundaries

Only routed Codex compaction turns are eligible (remote compaction v1 via the internal v2
turn and v2 compaction triggers). OpenAI/ChatGPT native passthrough, ordinary inference,
tool-call records, developer/system instructions, user messages, and the latest four messages
are untouched. Only long, old, prose-only **tool-result strings** are candidates.

The compressor is allowed to lose low-value detail. It must never be treated as a source of
truth for permissions, workflow FSM, transaction idempotency or exact tool output.

### Local sidecar API

```http
POST http://127.0.0.1:9009/compress
Content-Type: application/json

{"text":"Long historical prose from an old tool result...","rate":0.5}
```

Expected successful JSON response:

```json
{"compressed_text":"Historical context in a shorter form."}
```

The operator may use LLMLingua-2 behind this endpoint (e.g. token-classification
checkpoint microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank), subject to
the model's independent license terms. Neither model weights nor upstream implementation
are vendored here.

### Enable

```sh
export OPENCODEX_LLMLINGUA2_URL=http://127.0.0.1:9009/compress
export OPENCODEX_LLMLINGUA2_RATE=0.5
ocx start
```

Unset `OPENCODEX_LLMLINGUA2_URL` to disable instantly.

### Safeguards

- HTTP loopback addresses only; no credentials or query string in the endpoint.
- Sidecar timeout defaults to 1500 ms and is bounded to 5000 ms.
- Invalid/failed/empty/non-reducing outputs are ignored; original message remains.
- Only actually shortened outputs (<90% of original characters) are accepted.
- No source context, tool calls, model-native compaction blobs, or user/developer messages
  are modified. No compression in normal agent requests.
- The processed source is not forwarded to a remote sidecar by this adapter, but the
  loopback operator remains responsible for process isolation and data handling.
- The filter is heuristic, not a proof of safety. Explicitly opt in only after reviewing
  your data sensitivity and sidecar security.

### Test

```sh
bun test tests/llmlingua2-sidecar.test.ts
bun run typecheck
```

### Research and licenses

- LLMLingua-2: https://aclanthology.org/2024.findings-acl.57/
- Upstream implementation: https://github.com/microsoft/LLMLingua (MIT)
- Small multilingual checkpoint: https://huggingface.co/microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank (Apache-2.0)
- Large checkpoint: https://huggingface.co/microsoft/llmlingua-2-xlm-roberta-large-meetingbank (MIT)

This adapter is original integration code; third-party code/weights are not copied.
