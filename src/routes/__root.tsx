import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useNavigate,
  useLocation,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import { useEffect, type ReactNode } from "react";
import { Phone, Moon, Sun } from "lucide-react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import agencyLogo from "../assets/agency-logo.png.asset.json";
import {
  CallControlProvider,
  useCallControl,
} from "../lib/call-control";
import { ThemeProvider, useTheme, themeInitScript } from "../lib/theme";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "easeGrow AI" },
      {
        name: "description",
        content:
          "A live preview of easeGrow AI's voice agent right in your browser. Tap to talk.",
      },
      { name: "author", content: "easeGrow AI" },
      { property: "og:title", content: "easeGrow AI" },
      {
        property: "og:description",
        content:
          "A live preview of easeGrow AI's voice agent right in your browser. Tap to talk.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "easeGrow AI" },
      { name: "twitter:description", content: "A live preview of easeGrow AI's voice agent right in your browser. Tap to talk." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/YKtIUmAEkMZCogEGH2BnGmYPjiv2/social-images/social-1784474916174-ChatGPT_Image_Jul_19,_2026,_08_58_24_PM.webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/YKtIUmAEkMZCogEGH2BnGmYPjiv2/social-images/social-1784474916174-ChatGPT_Image_Jul_19,_2026,_08_58_24_PM.webp" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CallControlProvider>
          <div className="min-h-screen bg-background text-foreground font-['DM_Sans'] selection:bg-primary/30">
            <SiteNav />
            <Outlet />
            <SiteFooter />
          </div>
        </CallControlProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}


function SiteNav() {
  const { requestCall } = useCallControl();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  const handleCallNow = async () => {
    if (location.pathname !== "/") {
      await navigate({ to: "/" });
    }
    requestCall();
  };



  return (
    <nav className="fixed top-0 w-full z-50 flex items-center justify-between gap-3 px-4 sm:px-5 md:px-6 py-2.5 sm:py-3 border-b border-border bg-background/80 backdrop-blur-md">
      <Link to="/" className="flex items-center">
        <img
          src={agencyLogo.url}
          alt="easeGrow AI"
          className="h-7 sm:h-9 w-auto opacity-90 hover:opacity-100 transition-opacity light:invert"
        />
      </Link>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={handleCallNow}
          className="btn-primary group !py-1.5 !px-3 !text-xs sm:!text-sm shrink-0"
          aria-label="Start a call with the voice agent"
        >
          <Phone
            className="size-4 transition-transform duration-200 ease-out group-hover:-rotate-6 group-hover:scale-110 group-active:scale-95"
            strokeWidth={2}
            aria-hidden
          />
          Call now
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="inline-flex items-center justify-center size-8 sm:size-9 rounded-full border border-border bg-surface text-foreground/80 hover:text-primary hover:border-primary/50 transition-colors cursor-pointer"
        >
          {theme === "dark" ? (
            <Sun className="size-4" strokeWidth={2} aria-hidden />
          ) : (
            <Moon className="size-4" strokeWidth={2} aria-hidden />
          )}
        </button>
      </div>
    </nav>
  );
}



function SiteFooter() {
  return (
    <footer className="px-4 sm:px-6 md:px-8 py-8 md:py-12 border-t border-border mt-16 md:mt-20 flex flex-col md:flex-row justify-between items-center gap-6 text-center">
      <div className="text-muted-foreground text-xs sm:text-sm">
        © {new Date().getFullYear()} easeGrow AI
      </div>
    </footer>
  );
}
