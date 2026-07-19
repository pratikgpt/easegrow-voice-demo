import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 pt-24 text-center">
      <h1 className="font-['Space_Grotesk'] text-3xl font-semibold sm:text-4xl">
        Talk to an easeGrow AI voice agent
      </h1>
    </main>
  );
}
