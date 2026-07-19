import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

// 3 calls per 15 minutes per IP.
const MAX_CALLS = 3;
const WINDOW_MS = 15 * 60 * 1000;

function getClientIp(): string {
  // Cloudflare Workers set cf-connecting-ip; fall back to x-forwarded-for.
  const cf = getRequestHeader("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = getRequestHeader("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = getRequestHeader("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export const reserveCallSlot = createServerFn({ method: "POST" }).handler(
  async (): Promise<RateLimitResult> => {
    const ip = getClientIp();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

    // Best-effort cleanup of old rows for this IP to keep the table small.
    await supabaseAdmin
      .from("call_rate_limits")
      .delete()
      .eq("ip", ip)
      .lt("created_at", windowStart);

    const { data: recent, error: selectError } = await supabaseAdmin
      .from("call_rate_limits")
      .select("created_at")
      .eq("ip", ip)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: true });

    if (selectError) {
      // Fail open on unexpected DB errors so a real visitor is never blocked
      // by an infra hiccup. The insert below still tries to record the call.
      console.error("[rate-limit] select failed", selectError);
    }

    const hits = recent ?? [];
    if (hits.length >= MAX_CALLS) {
      const oldest = new Date(hits[0]!.created_at).getTime();
      const retryAfterMs = Math.max(0, oldest + WINDOW_MS - Date.now());
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    const { error: insertError } = await supabaseAdmin
      .from("call_rate_limits")
      .insert({ ip });
    if (insertError) {
      console.error("[rate-limit] insert failed", insertError);
    }

    return { allowed: true, remaining: MAX_CALLS - hits.length - 1 };
  },
);