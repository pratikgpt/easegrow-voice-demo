## What's happening

The call keeps going after you say "hang up" / "end the call" because the Vapi assistant itself isn't configured to hang up on voice command. Vapi only ends a call when one of these happens:

1. The user clicks our End Session button (works today).
2. The assistant calls the built-in **`endCall`** tool — this requires `endCallFunctionEnabled: true` on the assistant.
3. The user says one of the assistant's **`endCallPhrases`** (e.g. "goodbye", "hang up", "end the call") — requires that list to be set.
4. There is a period of silence longer than **`silenceTimeoutSeconds`**.
5. The total call exceeds **`maxDurationSeconds`**.

Right now none of #2–#5 are enabled on either of your two assistants, so the model just keeps listening — that's why saying "hello" starts a new exchange even after you asked it to hang up.

There are two places this can be fixed. We'll do both so it works even if the dashboard config drifts.

## Plan

### 1. Send `assistantOverrides` from the web client on every `vapi.start(...)`

`vapi.start(assistantId, assistantOverrides)` merges overrides into the assistant for that call only. In `src/hooks/use-vapi.ts` inside `start(...)`, pass:

```ts
await vapi.start(assistantId, {
  endCallFunctionEnabled: true,
  endCallPhrases: [
    "goodbye", "good bye", "bye", "bye bye",
    "hang up", "end the call", "end call",
    "that's all", "that is all", "we're done", "we are done",
    "talk to you later"
  ],
  silenceTimeoutSeconds: 30,       // auto-end after 30s of total silence
  maxDurationSeconds: 600          // hard cap: 10 minutes
});
```

Also add a short instruction to the assistant's system prompt at call time (via `assistantOverrides.model.messages` or `firstMessageMode`-adjacent `variableValues`) so the model knows it *may* hang up when the caller clearly wants to end — this is what triggers the `endCall` tool for phrasings not in the literal list (e.g. "okay thanks, that's it for now").

### 2. Handle `call-end` in the UI so the state actually resets

Currently `call-end` sets `status = "ended"` but the orb still shows the red "stop" style until the user taps again. Update the reducer path in `use-vapi.ts` so on `call-end` we also:

- reset `duration` display
- reset `startedAt` to `null`
- clear the partial-transcript accumulator

so a fresh tap-to-call starts cleanly.

### 3. (Recommended, in your Vapi dashboard — no code)

For each of your two assistants (Real Estate `6cba3d11…` and Law `57350fb7…`) turn on the same three fields at the assistant level so phone calls or other clients also hang up correctly:

- **End Call Function** → Enabled
- **End Call Phrases** → the list above
- **Silence Timeout** → 30s, **Max Duration** → 600s

Client overrides win when both are set, so this step is belt-and-braces.

## Verification

- Start a call, say "okay, goodbye" → call ends within ~1s, orb returns to "Tap to call".
- Start a call, stay silent for 30s → call auto-ends.
- Start a call, click End Session manually → still works exactly as today.
- Refresh, tap-to-call again → transcript panel clears, duration resets to 00:00.

## Docs referenced

- Vapi Web SDK `vapi.start(assistantId, assistantOverrides)` — https://docs.vapi.ai/sdk/web
- Assistant call-ending config (`endCallFunctionEnabled`, `endCallPhrases`, `silenceTimeoutSeconds`, `maxDurationSeconds`) — https://docs.vapi.ai/assistants
