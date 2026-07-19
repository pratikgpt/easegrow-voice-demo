// Vapi Web SDK configuration.
// Both the public key and assistant ID are publishable — safe to ship in
// client code. Paste your values below or override with Vite env vars.
//
// Get them from: https://dashboard.vapi.ai/
//   - Public key:   Settings → API Keys → Public Key
//   - Assistant ID: Assistants → your assistant → copy the ID

export const VAPI_PUBLIC_KEY =
  (import.meta.env.VITE_VAPI_PUBLIC_KEY as string | undefined) ??
  "0e7fb3f8-357f-4a56-b83d-c3add083b4b5";

export type AssistantKey = "realestate" | "law";

export type AssistantOption = {
  key: AssistantKey;
  id: string;
  label: string;
  tagline: string;
  prompts: readonly string[];
};

export const ASSISTANTS: readonly AssistantOption[] = [
  {
    key: "realestate",
    id: "6cba3d11-e1aa-485e-a301-17ec8552f38b",
    label: "Real Estate Agent",
    tagline: "Handles real estate inquiries — listings, buyers, and closings.",
    prompts: [
      "I'm looking for a 3-bedroom home",
      "What's the market like right now?",
      "Help me schedule a property tour",
    ],
  },
  {
    key: "law",
    id: "57350fb7-5ba9-4329-897f-be4048e4d2fd",
    label: "Legal Advisor",
    tagline: "Handles legal inquiries — contracts, rights, and business questions.",
    prompts: [
      "I need help reviewing a contract",
      "What are my rights as a tenant?",
      "Explain how an LLC works",
    ],
  },
] as const;

export const DEFAULT_ASSISTANT_KEY: AssistantKey = "realestate";

export const isVapiConfigured =
  Boolean(VAPI_PUBLIC_KEY) && VAPI_PUBLIC_KEY !== "YOUR_VAPI_PUBLIC_KEY";