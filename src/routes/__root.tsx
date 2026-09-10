import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "衡價";

function asset(path: string) {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${path.replace(/^\//, "")}`;
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "theme-color", content: "#0c0d0b" },
      {
        name: "description",
        content: "輸入股票代號，用 DCF、股利折現與相對倍數估算內在價值。",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: asset("favicon.svg") },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: asset("__grok/manifest.webmanifest") },
      { rel: "apple-touch-icon", href: asset("__grok/icon-180.png") },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+TC:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: () =>
    import.meta.env.VITE_STATIC === "1" ? (
      <>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
      </>
    ) : (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
    ),
});
