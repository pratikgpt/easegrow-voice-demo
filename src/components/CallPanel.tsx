import { useEffect, useMemo, useRef, useState } from "react";
import { useVapi, type FeedItem } from "@/hooks/use-vapi";
import { useServerFn } from "@tanstack/react-start";
import { reserveCallSlot } from "@/lib/rate-limit.functions";
import { useCallControl } from "@/lib/call-control";
import {
  ASSISTANTS,
  DEFAULT_ASSISTANT_KEY,
  type AssistantKey,
} from "@/lib/vapi-config";


function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatRetryAfter(seconds: number) {
  if (seconds <= 60) return `${Math.max(1, seconds)} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function downloadTranscript(feed: FeedItem[]) {
  const lines = feed.map((item) => {
    if (item.kind === "tool") {
      return `[${formatTime(item.timestamp)}] TOOL ${item.name}${
        item.args ? ` ${JSON.stringify(item.args)}` : ""
      }`;
    }
    return `[${formatTime(item.timestamp)}] ${item.role.toUpperCase()}: ${item.text}`;
  });
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `easegrow-transcript-${new Date().toISOString().slice(0, 19)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CallPanel() {
  const {
    status,
    isMuted,
    volume,
    isAssistantSpeaking,
    feed,
    error,
    duration,
    isConfigured,
    start,
    stop,
    toggleMute,
    sendMessage,
    clearError,
  } = useVapi();

  const [note, setNote] = useState("");
  const feedRef = useRef<HTMLDivElement | null>(null);
  const [assistantKey, setAssistantKey] = useState<AssistantKey>(
    DEFAULT_ASSISTANT_KEY,
  );
  const [rateLimit, setRateLimit] = useState<{
    retryAfterSeconds: number;
  } | null>(null);
  const [checkingLimit, setCheckingLimit] = useState(false);
  const reserveSlot = useServerFn(reserveCallSlot);
  const { registerCallHandler } = useCallControl();
  const inFlightRef = useRef(false);
  const assistant =
    ASSISTANTS.find((a) => a.key === assistantKey) ?? ASSISTANTS[0];


  // Auto-scroll transcript
  useEffect(() => {
    if (!feedRef.current) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [feed]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (e.code === "Space" && status === "active") {
        e.preventDefault();
        toggleMute();
      }
      if (e.code === "Escape" && (status === "active" || status === "connecting")) {
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, toggleMute, stop]);

  const isLive = status === "active" || status === "connecting";

  const orbScale = useMemo(
    () => 1 + Math.min(volume, 1) * 0.25,
    [volume],
  );

  const handlePrimary = async () => {
    if (isLive) {
      stop();
      return;
    }
    if (checkingLimit || inFlightRef.current) return;
    inFlightRef.current = true;
    setCheckingLimit(true);
    try {
      const result = await reserveSlot();
      if (!result.allowed) {
        setRateLimit({ retryAfterSeconds: result.retryAfterSeconds });
        return;
      }
      setRateLimit(null);
      start(assistant.id);
    } catch (e) {
      // Fail open — a rate-limit outage shouldn't block real visitors.
      console.error("[rate-limit] check failed", e);
      start(assistant.id);
    } finally {
      setCheckingLimit(false);
      inFlightRef.current = false;
    }
  };



  // Register the primary call action with the global "Call now" header CTA.
  const handlePrimaryRef = useRef(handlePrimary);
  handlePrimaryRef.current = handlePrimary;

  useEffect(() => {
    return registerCallHandler(() => {
      handlePrimaryRef.current();
    });
  }, [registerCallHandler]);



  // Live countdown for the rate-limit notice.
  useEffect(() => {
    if (!rateLimit) return;
    if (rateLimit.retryAfterSeconds <= 0) {
      setRateLimit(null);
      return;
    }
    const id = window.setInterval(() => {
      setRateLimit((prev) => {
        if (!prev) return prev;
        const next = prev.retryAfterSeconds - 1;
        if (next <= 0) return null;
        return { retryAfterSeconds: next };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [rateLimit]);


  return (
    <div className="relative pt-24 md:pt-28 lg:pt-32 grid grid-cols-1 lg:grid-cols-12 min-h-screen px-4 sm:px-6 md:px-8 gap-8 lg:gap-12">
      {/* Hero & Orb */}
      <div className="lg:col-span-7 flex flex-col justify-center items-center lg:items-start space-y-8 md:space-y-12 pb-12 lg:pb-32">
        {/* Assistant selector */}
        <div
          className="flex flex-wrap gap-2 justify-center lg:justify-start"
          role="tablist"
          aria-label="Choose an assistant"
        >
          {ASSISTANTS.map((a) => {
            const active = a.key === assistantKey;
            return (
              <button
                key={a.key}
                role="tab"
                aria-selected={active}
                disabled={isLive}
                onClick={() => setAssistantKey(a.key)}
              className={`px-3 sm:px-4 py-2 rounded-full text-[10px] sm:text-xs uppercase tracking-widest font-mono border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground hover:border-primary/30"
                }`}
              >
                {a.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-4 max-w-xl animate-float text-center lg:text-left px-2 sm:px-0">
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-semibold tracking-tight leading-[1.1] text-balance">
            {assistant.label.split(" ")[0]}{" "}
            <span className="text-muted-foreground italic font-normal">
              {assistant.label.split(" ").slice(1).join(" ").toLowerCase() ||
                "assistant"}
              .
            </span>
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground text-pretty max-w-md mx-auto lg:mx-0">
            {assistant.tagline} Press the button and start a real conversation.
          </p>
        </div>

        <div className="relative mx-auto flex items-center justify-center size-[280px] sm:size-[380px] lg:size-[500px]">
          {/* Breathing Orb */}
          <div
            className="absolute inset-0 bg-primary/20 rounded-full blur-[100px] animate-orb pointer-events-none"
            style={{
              transform: `scale(${orbScale})`,
              transition: "transform 120ms linear",
            }}
          />
          <div
            className="absolute size-40 sm:size-56 lg:size-72 bg-primary/40 rounded-full blur-[60px] animate-orb pointer-events-none"
            style={{ animationDelay: "1s" }}
          />

          <button
            onClick={handlePrimary}
            aria-label={isLive ? "End call" : "Start talking"}
            className={`relative size-40 sm:size-52 lg:size-64 rounded-full flex flex-col items-center justify-center gap-2 text-primary-foreground font-semibold shadow-[0_0_120px_rgba(255,140,60,0.55)] ring-1 ring-white/20 transition-transform hover:scale-[1.03] active:scale-95 cursor-pointer ${
              isLive
                ? "bg-red-500 shadow-[0_0_120px_rgba(239,68,68,0.55)]"
                : "bg-primary"
            }`}
            style={{
              transform: `scale(${isAssistantSpeaking ? 1.06 : 1})`,
              transition: "transform 200ms ease-out",
            }}
          >
            <span className="text-2xl sm:text-3xl" aria-hidden>
              {isLive ? "■" : "☎"}
            </span>
            <span className="text-xs sm:text-sm uppercase tracking-widest">
              {status === "connecting"
                ? "Connecting…"
                : status === "active"
                  ? formatDuration(duration)
                  : "Tap to call"}
            </span>
          </button>
        </div>

        {!isConfigured && (
          <div className="max-w-md text-xs text-muted-foreground border border-border rounded-lg p-4 bg-surface">
            <strong className="text-foreground">Vapi not configured.</strong>{" "}
            Add your public key and assistant ID in{" "}
            <code className="font-mono text-primary">src/lib/vapi-config.ts</code>{" "}
            (or set{" "}
            <code className="font-mono">VITE_VAPI_PUBLIC_KEY</code> and{" "}
            <code className="font-mono">VITE_VAPI_ASSISTANT_ID</code>).
          </div>
        )}

        {error && (
          <div className="max-w-md text-xs text-destructive-foreground border border-destructive/40 rounded-lg p-4 bg-destructive/10 flex items-start justify-between gap-3">
            <span>{error}</span>
            <button
              onClick={clearError}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {rateLimit && (
          <div
            role="status"
            aria-live="polite"
            className="max-w-md w-full border border-primary/30 bg-primary/5 rounded-2xl p-5 text-center lg:text-left space-y-2"
          >
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
              Too many calls
            </div>
            <div className="text-sm text-foreground leading-relaxed">
              You've started a few calls in a short window. Please try again in{" "}
              <span className="font-semibold text-primary">
                {formatRetryAfter(rateLimit.retryAfterSeconds)}
              </span>
              .
            </div>
          </div>
        )}
      </div>

      {/* Transcript Sidebar */}
      <div className="lg:col-span-5 flex flex-col h-[70vh] lg:h-[calc(100vh-160px)] pb-8 lg:pb-0 lg:sticky lg:top-32">
        <div className="bg-surface/50 border border-border rounded-2xl flex-1 flex flex-col overflow-hidden">
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Live Transcript
            </span>
            <div className="flex items-center gap-3">
              {isLive && (
                <span className="text-xs font-mono text-muted-foreground">
                  {formatDuration(duration)}
                </span>
              )}
              <div className="flex gap-1" aria-hidden>
                <div
                  className={`size-1.5 rounded-full ${
                    isLive ? "bg-primary animate-pulse" : "bg-primary/30"
                  }`}
                />
                <div className="size-1.5 rounded-full bg-primary/40" />
                <div className="size-1.5 rounded-full bg-primary/20" />
              </div>
            </div>
          </div>

          <div
            ref={feedRef}
            className="flex-1 p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto font-mono text-sm"
          >
            {feed.length === 0 && (
              <div className="space-y-2 animate-stream">
                <div className="text-muted-foreground text-[10px] uppercase tracking-tighter">
                  Waiting
                </div>
                <div className="text-muted-foreground/80 italic leading-relaxed">
                  Your conversation will appear here in real time. Hit{" "}
                  <span className="text-foreground">Start talking</span> to
                  begin.
                </div>
              </div>
            )}

            {feed.map((item) => {
              if (item.kind === "tool") {
                return (
                  <div
                    key={item.id}
                    className="animate-stream border border-primary/20 bg-primary/5 rounded-lg p-3 space-y-1"
                  >
                    <div className="text-primary text-[10px] uppercase tracking-tighter">
                      Tool · {item.name}
                    </div>
                    {item.args !== undefined && (
                      <div className="text-muted-foreground text-xs break-all">
                        {typeof item.args === "string"
                          ? item.args
                          : JSON.stringify(item.args)}
                      </div>
                    )}
                  </div>
                );
              }
              const isUser = item.role === "user";
              return (
                <div key={item.id} className="space-y-2 animate-stream">
                  <div
                    className={`text-[10px] uppercase tracking-tighter ${
                      isUser ? "text-muted-foreground" : "text-primary"
                    }`}
                  >
                    {isUser ? "You" : "Voice Agent"} · {formatTime(item.timestamp)}
                    {!item.final && " · …"}
                  </div>
                  <div
                    className={`leading-relaxed ${
                      isUser
                        ? "text-foreground"
                        : "text-foreground/90 italic"
                    }`}
                  >
                    {item.text}
                  </div>
                </div>
              );
            })}

            {isLive && (
              <div className="space-y-2 animate-stream border-l-2 border-primary/20 pl-4 bg-primary/5 py-3 rounded-r-lg">
                <div className="text-primary text-[10px] uppercase tracking-tighter">
                  {isAssistantSpeaking ? "Speaking…" : "Listening…"}
                </div>
                <div className="text-muted-foreground animate-pulse">
                  {isAssistantSpeaking ? "Voice Agent is responding" : "Waiting for input"}
                </div>
              </div>
            )}
          </div>

          {/* Note input while live */}
          {isLive && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) {
                  sendMessage(note);
                  setNote("");
                }
              }}
              className="px-4 py-3 border-t border-border flex gap-2"
            >
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Send a text note to Voice Agent…"
                className="flex-1 bg-transparent border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-primary/20 border border-primary/40 text-primary text-xs uppercase tracking-widest font-medium hover:bg-primary/30 transition-colors"
              >
                Send
              </button>
            </form>
          )}

          {/* Controls */}
          <div className="p-4 border-t border-border grid grid-cols-2 gap-3">
            <button
              onClick={toggleMute}
              disabled={!isLive}
              className="py-3 rounded-xl bg-surface border border-border hover:bg-foreground/5 transition-colors font-medium text-xs uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isMuted ? "Unmute" : "Mute"} Mic
            </button>
            {isLive ? (
              <button
                onClick={stop}
                className="py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors font-medium text-xs uppercase tracking-widest"
              >
                End Session
              </button>
            ) : (
              <button
                onClick={() => downloadTranscript(feed)}
                disabled={feed.length === 0}
                className="py-3 rounded-xl bg-surface border border-border hover:bg-foreground/5 transition-colors font-medium text-xs uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Download .txt
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}