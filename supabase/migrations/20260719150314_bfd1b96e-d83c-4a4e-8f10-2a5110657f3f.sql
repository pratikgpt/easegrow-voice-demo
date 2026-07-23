
CREATE TABLE public.call_rate_limits (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX call_rate_limits_ip_created_at_idx
  ON public.call_rate_limits (ip, created_at DESC);

GRANT ALL ON public.call_rate_limits TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.call_rate_limits_id_seq TO service_role;

ALTER TABLE public.call_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (via server-side admin client) may read/write.
