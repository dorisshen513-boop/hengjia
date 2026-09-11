#!/usr/bin/env node
/**
 * After the client bundle is emitted, write a GitHub Pages SPA shell so the
 * hashed JS/CSS load from /hengjia/ and unknown paths still serve the app.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  join(root, "dist", "client"),
  join(root, ".output", "public"),
  join(root, "dist"),
];
const pub = candidates.find((dir) => existsSync(join(dir, "assets")));
if (!pub) {
  console.error("[pages-postbuild] missing dist/client assets");
  process.exit(1);
}

const assetsDir = join(pub, "assets");
const files = readdirSync(assetsDir);
const js =
  files.find((f) => /^index-.*\.js$/.test(f)) ??
  files.find((f) => f.endsWith(".js") && !f.startsWith("routes-"));
const css = files.find((f) => f.endsWith(".css"));
if (!js) {
  console.error("[pages-postbuild] no client JS in", assetsDir, files);
  process.exit(1);
}

const base = (process.env.VITE_BASE || "/hengjia/").replace(/\/?$/, "/");
const shellPath = join(pub, "_shell.html");
const shell = existsSync(shellPath) ? readFileSync(shellPath, "utf8") : "";

const html = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0c0d0b" />
    <title>衡價</title>
    <meta name="description" content="免登入的公開估價工具。輸入美股或台股代號，用 DCF、剩餘收益與相對倍數看合理價與魚帶。不是投資建議。" />
    <link rel="canonical" href="https://dorisshen513-boop.github.io/hengjia/" />
    <meta property="og:title" content="衡價" />
    <meta property="og:description" content="免登入。輸入代號即可看合理價與魚帶。" />
    <meta property="og:url" content="https://dorisshen513-boop.github.io/hengjia/" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="zh_TW" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="衡價" />
    <meta name="twitter:description" content="免登入的公開估價工具。輸入代號即可看合理價與魚帶。" />
    <link rel="icon" type="image/svg+xml" href="${base}favicon.svg" />
    ${css ? `<link rel="stylesheet" href="${base}assets/${css}" />` : ""}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+TC:wght@400;500;600&display=swap" />
  </head>
  <body>
    <div id="app"></div>
    ${shell}
    <script type="module" src="${base}assets/${js}"></script>
  </body>
</html>
`;

writeFileSync(join(pub, "index.html"), html);
writeFileSync(join(pub, "404.html"), html);
writeFileSync(join(pub, ".nojekyll"), "");
writeFileSync(
  join(pub, "robots.txt"),
  "User-agent: *\nAllow: /\nSitemap: https://dorisshen513-boop.github.io/hengjia/sitemap.xml\n",
);
writeFileSync(
  join(pub, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://dorisshen513-boop.github.io/hengjia/</loc>
    <changefreq>weekly</changefreq>
  </url>
</urlset>
`,
);
console.log("[pages-postbuild] wrote index.html + 404.html using", js, css ?? "(no css)");
console.log("[pages-postbuild] ready", pub);
