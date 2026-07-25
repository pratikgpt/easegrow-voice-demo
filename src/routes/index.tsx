import { createFileRoute } from "@tanstack/react-router";
import { CallPanel } from "@/components/CallPanel";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return <CallPanel />;
}
