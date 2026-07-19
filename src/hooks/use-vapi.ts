import { useCallback, useEffect, useRef, useState } from "react";
import {
  VAPI_PUBLIC_KEY,
  isVapiConfigured,
} from "@/lib/vapi-config";
import {
  acquireCallLock,
  generateTabId,
  otherTabHoldingCall,
} from "@/lib/call-lock";

type VapiInstance = {
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  start: (assistantId: string, assistantOverrides?: unknown) => Promise<unknown>;
  stop: () => Promise<void> | void;
  isMuted: () => boolean;
  setMuted: (muted: boolean) => void;
  send: (message: unknown) => void;
  say: (text: string, endCallAfterSpoken?: boolean) => void;
};

type VapiConstructor = new (publicKey: string) => VapiInstance;

export type CallStatus = "idle" | "connecting" | "active" | "ended" | "error";
type SdkStatus = "idle" | "loading" | "ready" | "error";

export type TranscriptEntry = {
  id: string;
  kind: "message";
  role: "user" | "assistant" | "system";
  text: string;
  final: boolean;
  timestamp: number;
};

export type ToolCallEntry = {
  id: string;
  kind: "tool";
  name: string;
  args?: unknown;
  timestamp: number;
};

export type FeedItem = TranscriptEntry | ToolCallEntry;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveVapiConstructor(module: unknown): VapiConstructor | null {
  const candidate = module as {
    default?: unknown;
  };
  const defaultCandidate = candidate.default as { default?: unknown } | undefined;
  const constructors = [
    module,
    candidate.default,
    defaultCandidate?.default,
  ];

  for (const value of constructors) {
    if (typeof value === "function") {
      return value as VapiConstructor;
    }
  }

  return null;
}

function getVapiErrorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || fallback;
  if (typeof error !== "object") return String(error);

  const record = error as Record<string, unknown>;
  const candidates = [
    record.errorMsg,
    record.message,
    record.reason,
    record.details,
    record.error,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (candidate instanceof Error && candidate.message) return candidate.message;
    if (candidate && typeof candidate === "object") {
      const nested: string = getVapiErrorMessage(candidate, "");
      if (nested) return nested;
    }
  }

  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}

// Vapi/Daily emit an "error" event after a normal hang-up (assistant-triggered
// endCall, hard timeout, ejection). These are not user-facing errors and must
// not flip the UI into an error state or surface a red banner.
const BENIGN_END_PATTERNS = [
  /meeting has ended/i,
  /meeting ended/i,
  /meeting.*ended/i,
  /session.*ended/i,
  /ejected/i,
  /call has ended/i,
  /call.*ended/i,
  /left the meeting/i,
  /customer-ended-call/i,
  /assistant-ended-call/i,
  /end-call/i,
  /endCall/i,
  /room.*ended/i,
  /already.*destroy/i,
];

function isBenignCallEndError(message: string, raw: unknown) {
  const haystack = `${message} ${safeStringify(raw)}`;
  if (BENIGN_END_PATTERNS.some((r) => r.test(haystack))) return true;
  const type = (raw as { type?: string; error?: { type?: string } })?.type ??
    (raw as { error?: { type?: string } })?.error?.type;
  if (typeof type === "string" && /ejected|ended/i.test(type)) return true;
  return false;
}

function safeStringify(value: unknown) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name} ${value.message} ${value.stack ?? ""}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function looksLikeVapiRejection(reason: unknown) {
  const msg =
    reason instanceof Error
      ? `${reason.message} ${reason.stack ?? ""}`
      : typeof reason === "string"
        ? reason
        : (() => {
            try {
              return JSON.stringify(reason);
            } catch {
              return String(reason);
            }
          })();
  return /vapi|daily|meeting|webrtc|peerconnection|ejected/i.test(msg);
}

function stopVapiSafely(vapi: VapiInstance | null) {
  if (!vapi) return;
  try {
    const result = vapi.stop();
    if (result && typeof result === "object" && "catch" in result) {
      result.catch((e) => {
        if (!isBenignCallEndError(getVapiErrorMessage(e, ""), e)) {
          // eslint-disable-next-line no-console
          console.warn("[vapi] stop failed", e);
        }
      });
    }
  } catch (e) {
    if (!isBenignCallEndError(getVapiErrorMessage(e, ""), e)) {
      // eslint-disable-next-line no-console
      console.warn("[vapi] stop failed", e);
    }
  }
}

export function useVapi() {
  const vapiRef = useRef<VapiInstance | null>(null);
  const setupPromiseRef = useRef<Promise<VapiInstance | null> | null>(null);
  const lastCallEndedAtRef = useRef(0);
  const tabIdRef = useRef<string>(generateTabId());
  const releaseLockRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const statusRef = useRef<CallStatus>("idle");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const [sdkStatus, setSdkStatus] = useState<SdkStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);

  const releaseLock = useCallback(() => {
    if (releaseLockRef.current) {
      releaseLockRef.current();
      releaseLockRef.current = null;
    }
  }, []);

  // Partial transcript accumulator (keyed by role) so we can update in-place
  const partialRef = useRef<Record<"user" | "assistant", string | null>>({
    user: null,
    assistant: null,
  });

  const setupVapi = useCallback(async () => {
    if (typeof window === "undefined") return null;
    if (!isVapiConfigured) return null;
    if (vapiRef.current) return vapiRef.current;
    if (setupPromiseRef.current) return setupPromiseRef.current;

    setSdkStatus("loading");

    setupPromiseRef.current = (async () => {
      try {
        // Load via jsDelivr's ESM bundle. The npm package is CJS and pulls
        // Node's `events` module via `__importDefault`; some bundler paths
        // resolve it to a namespace object, which makes `class Vapi extends
        // events_1.default` throw "Class extends value #<Object> is not a
        // constructor". The +esm bundle ships a browser-ready build.
        const cdnUrl = "https://cdn.jsdelivr.net/npm/@vapi-ai/web@2.6.1/+esm";
        const module = await import(/* @vite-ignore */ cdnUrl);
        const Vapi = resolveVapiConstructor(module);

        if (!Vapi) {
          throw new TypeError("Vapi SDK constructor could not be resolved.");
        }

        const vapi = new Vapi(VAPI_PUBLIC_KEY);
        vapiRef.current = vapi;

        vapi.on("call-start", () => {
          setStatus("active");
          setStartedAt(Date.now());
          lastCallEndedAtRef.current = 0;
          setError(null);
        });
        vapi.on("call-end", () => {
          lastCallEndedAtRef.current = Date.now();
          setStatus("ended");
          setError(null);
          setIsAssistantSpeaking(false);
          setVolume(0);
          setStartedAt(null);
          setDuration(0);
          partialRef.current = { user: null, assistant: null };
          releaseLock();
        });
        vapi.on("speech-start", () => setIsAssistantSpeaking(true));
        vapi.on("speech-end", () => setIsAssistantSpeaking(false));
        vapi.on("volume-level", (v) => setVolume(Number(v) || 0));
        vapi.on("call-start-failed", (e) => {
          const message = getVapiErrorMessage(
            e,
            "Vapi could not start the call.",
          );
          setError(message);
          setStatus("error");
          setIsAssistantSpeaking(false);
          setVolume(0);
          releaseLock();
          // eslint-disable-next-line no-console
          console.error("[vapi] call-start-failed", e);
        });
        vapi.on("error", (e) => {
          const message = getVapiErrorMessage(
            e,
            "Something went wrong with the call.",
          );
          // Assistant-triggered endCall (and timeouts) fire an "error" event
          // *after* call-end with "Meeting has ended" / ejected reasons. Swallow.
          const justEnded = Date.now() - lastCallEndedAtRef.current < 8000;
          if (justEnded || isBenignCallEndError(message, e)) {
            // eslint-disable-next-line no-console
            console.info("[vapi] benign end signal", message);
            return;
          }
          setError(message);
          setStatus((prev) => (prev === "active" ? "active" : "error"));
          // eslint-disable-next-line no-console
          console.error("[vapi] error", e);
        });

        vapi.on("message", (msg) => {
          const message = msg as Record<string, unknown>;
          const type = message.type as string | undefined;

          if (type === "transcript") {
            const role = message.role as "user" | "assistant" | undefined;
            const text = (message.transcript as string | undefined) ?? "";
            const transcriptType = message.transcriptType as
              | "partial"
              | "final"
              | undefined;
            if (!role || (role !== "user" && role !== "assistant")) return;
            if (!text) return;

            setFeed((prev) => {
              const partialId = partialRef.current[role];
              if (transcriptType === "partial") {
                if (partialId) {
                  return prev.map((item) =>
                    item.id === partialId && item.kind === "message"
                      ? { ...item, text }
                      : item,
                  );
                }
                const id = makeId();
                partialRef.current[role] = id;
                const entry: TranscriptEntry = {
                  id,
                  kind: "message",
                  role,
                  text,
                  final: false,
                  timestamp: Date.now(),
                };
                return [...prev, entry];
              }
              // final
              if (partialId) {
                partialRef.current[role] = null;
                return prev.map((item) =>
                  item.id === partialId && item.kind === "message"
                    ? { ...item, text, final: true }
                    : item,
                );
              }
              // Dedupe: Vapi occasionally emits multiple final transcripts
              // for the same utterance (or a final without a preceding
              // partial). Skip if the previous message from this role has
              // identical text, or extend it if the new text is a superset.
              for (let i = prev.length - 1; i >= 0; i--) {
                const item = prev[i];
                if (item.kind !== "message") continue;
                if (item.role !== role) break;
                if (item.text === text) return prev;
                if (text.startsWith(item.text) || item.text.startsWith(text)) {
                  const longer = text.length > item.text.length ? text : item.text;
                  const next = prev.slice();
                  next[i] = { ...item, text: longer, final: true };
                  return next;
                }
                break;
              }
              const entry: TranscriptEntry = {
                id: makeId(),
                kind: "message",
                role,
                text,
                final: true,
                timestamp: Date.now(),
              };
              return [...prev, entry];
            });
            return;
          }

          if (type === "tool-calls" || type === "function-call") {
            const calls =
              (message.toolCalls as Array<{
                function?: { name?: string; arguments?: unknown };
                name?: string;
                arguments?: unknown;
              }>) ??
              (message.functionCall
                ? [
                    message.functionCall as {
                      name?: string;
                      parameters?: unknown;
                    },
                  ]
                : []);
            setFeed((prev) => [
              ...prev,
              ...calls.map<ToolCallEntry>((c) => ({
                id: makeId(),
                kind: "tool",
                name:
                  (c as { function?: { name?: string } }).function?.name ??
                  (c as { name?: string }).name ??
                  "tool",
                args:
                  (c as { function?: { arguments?: unknown } }).function
                    ?.arguments ??
                  (c as { parameters?: unknown; arguments?: unknown })
                    .parameters ??
                  (c as { arguments?: unknown }).arguments,
                timestamp: Date.now(),
              })),
            ]);
          }
        });

        setSdkStatus("ready");
        setError(null);
        return vapi;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to load Vapi.";
        setupPromiseRef.current = null;
        setSdkStatus("error");
        setError(message);
        setStatus("error");
        // eslint-disable-next-line no-console
        console.error("[vapi] setup error", e);
        return null;
      }
    })();

    return setupPromiseRef.current;
  }, []);

  // Lazy-init Vapi instance
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isVapiConfigured) return;
    if (vapiRef.current) return;
    void setupVapi();

    // Vapi's underlying Daily.co client sometimes emits unhandled promise
    // rejections while tearing down (e.g. after an assistant-triggered
    // endCall). Lovable's editor overlay listens for `unhandledrejection`
    // and shows a "This page didn't load" screen on any hit, so we swallow
    // rejections that clearly originate from the voice stack.
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const justEnded = Date.now() - lastCallEndedAtRef.current < 8000;
      if (justEnded || looksLikeVapiRejection(event.reason)) {
        // eslint-disable-next-line no-console
        console.warn("[vapi] swallowed teardown rejection", event.reason);
        event.preventDefault();
      }
    };
    const onWindowError = (event: ErrorEvent) => {
      const justEnded = Date.now() - lastCallEndedAtRef.current < 8000;
      const details = `${event.message} ${event.filename} ${event.error?.stack ?? ""}`;
      if (justEnded || /vapi|daily|meeting|webrtc|peerconnection|ejected/i.test(details)) {
        // eslint-disable-next-line no-console
        console.warn("[vapi] swallowed teardown error", event.message);
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onWindowError, true);

    // Stop the call cleanly when the tab is closed / navigated away so the
    // Vapi session doesn't keep running server-side.
    const onPageHide = () => {
      stopVapiSafely(vapiRef.current);
      releaseLock();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onWindowError, true);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
      stopVapiSafely(vapiRef.current);
      releaseLock();
      vapiRef.current = null;
      setupPromiseRef.current = null;
    };
  }, [setupVapi, releaseLock]);

  // Duration ticker
  useEffect(() => {
    if (status !== "active" || !startedAt) return;
    const tick = () => setDuration(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [status, startedAt]);

  const start = useCallback(async (assistantId: string) => {
    if (!isVapiConfigured) {
      setError(
        "Vapi is not configured. Add your public key in src/lib/vapi-config.ts.",
      );
      setStatus("error");
      return;
    }
    if (!assistantId) {
      setError("No assistant selected.");
      setStatus("error");
      return;
    }

    // Refuse to start while a prior call is still connecting or active in
    // this tab — prevents rapid double-clicks from spawning parallel sessions.
    if (vapiRef.current && (statusRef.current === "connecting" || statusRef.current === "active")) {
      return;
    }

    // Cross-tab guard: if another tab is mid-call, refuse.
    if (otherTabHoldingCall(tabIdRef.current)) {
      setError(
        "You already have a call open in another tab. End that call before starting a new one.",
      );
      setStatus("error");
      return;
    }

    const vapi = await setupVapi();

    if (!vapi) {
      setError(
        sdkStatus === "error"
          ? "Vapi could not initialize. Please refresh and try again."
          : "Vapi is still loading. Please try again in a moment.",
      );
      setStatus("error");
      return;
    }

    setError(null);
    setStatus("connecting");
    setFeed([]);
    setDuration(0);
    partialRef.current = { user: null, assistant: null };

    // Reserve the cross-tab lock as soon as we begin connecting. Released on
    // call-end, call-start-failed, or when stop() is called below.
    releaseLock();
    releaseLockRef.current = acquireCallLock(tabIdRef.current);
    try {
      const call = await vapi.start(assistantId, {
        "tools:append": [{ type: "endCall" }],
        endCallMessage: "Goodbye.",
        endCallPhrases: [
          "goodbye",
          "good bye",
          "bye",
          "bye bye",
          "hang up",
          "end the call",
          "end call",
          "that's all",
          "that is all",
          "we're done",
          "we are done",
          "talk to you later",
        ],
        silenceTimeoutSeconds: 30,
        maxDurationSeconds: 600,
      });
      if (!call) {
        setError("Vapi could not start the call. Check mic access and assistant settings.");
        setStatus("error");
        releaseLock();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to start call.";
      setError(message);
      setStatus("error");
      releaseLock();
    }
  }, [sdkStatus, setupVapi, releaseLock]);

  const stop = useCallback(() => {
    stopVapiSafely(vapiRef.current);
    // Optimistically release; if the SDK also emits call-end shortly after,
    // releaseLock() there is a safe no-op.
    releaseLock();
  }, [releaseLock]);

  const toggleMute = useCallback(() => {
    const v = vapiRef.current;
    if (!v) return;
    const next = !v.isMuted();
    v.setMuted(next);
    setIsMuted(next);
  }, []);

  const sendMessage = useCallback((text: string) => {
    const v = vapiRef.current;
    if (!v || !text.trim()) return;
    v.send({
      type: "add-message",
      message: { role: "user", content: text.trim() },
    });
    setFeed((prev) => [
      ...prev,
      {
        id: makeId(),
        kind: "message",
        role: "user",
        text: text.trim(),
        final: true,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const say = useCallback((text: string, endCallAfterSpoken = false) => {
    vapiRef.current?.say(text, endCallAfterSpoken);
  }, []);

  return {
    status,
    isMuted,
    volume,
    isAssistantSpeaking,
    feed,
    error,
    duration,
    isConfigured: isVapiConfigured,
    sdkStatus,
    start,
    stop,
    toggleMute,
    sendMessage,
    say,
    clearError: () => setError(null),
  };
}