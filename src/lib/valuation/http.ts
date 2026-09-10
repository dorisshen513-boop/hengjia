/** Browser-safe fetch. GitHub Pages has no server, so Yahoo/Nasdaq need CORS proxies. */

const BROWSER = typeof window !== "undefined";

type Kind = "direct" | "allorigins";

function stripBrowserHeaders(headers: Headers) {
  if (!BROWSER) return headers;
  for (const key of ["user-agent", "cookie", "origin", "referer"]) {
    headers.delete(key);
  }
  return headers;
}

function proxyAttempts(url: string): Array<{ url: string; kind: Kind }> {
  if (!BROWSER) return [{ url, kind: "direct" }];
  return [
    { url, kind: "direct" },
    { url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, kind: "allorigins" },
    { url: `https://corsproxy.io/?${encodeURIComponent(url)}`, kind: "direct" },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, kind: "direct" },
  ];
}

async function readAsData(res: Response, kind: Kind): Promise<Response> {
  if (kind === "allorigins") {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      contents?: unknown;
      status?: { http_code?: number; content_type?: string };
    };
    const code = data.status?.http_code ?? 200;
    const contents =
      typeof data.contents === "string" ? data.contents : JSON.stringify(data.contents ?? "");
    if (code >= 400) throw new Error(`HTTP ${code}`);
    if (/^\s*</.test(contents)) throw new Error("代理回了網頁而非資料");
    return new Response(contents, {
      status: 200,
      headers: { "Content-Type": data.status?.content_type || "application/json" },
    });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const head = new TextDecoder().decode(buf.slice(0, 96));
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html") || /^\s*<!doctype/i.test(head) || /^\s*<html/i.test(head)) {
    throw new Error("代理回了網頁而非資料");
  }
  return new Response(buf, { status: res.status, headers: res.headers });
}

async function hit(
  target: string,
  init: RequestInit | undefined,
  kind: Kind,
  timeoutMs: number,
): Promise<Response> {
  const headers = stripBrowserHeaders(new Headers(init?.headers));
  const res = await fetch(target, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return readAsData(res, kind);
}

export async function netFetch(url: string, init?: RequestInit): Promise<Response> {
  const attempts = proxyAttempts(url);
  const first = attempts[0];
  let last: Error | null = null;
  try {
    return await hit(first.url, init, first.kind, BROWSER ? 4000 : 12000);
  } catch (err) {
    last = err instanceof Error ? err : new Error(String(err));
  }
  const rest = attempts.slice(1);
  if (!rest.length) throw last ?? new Error("網路請求失敗");
  try {
    return await Promise.any(rest.map((a) => hit(a.url, init, a.kind, 9000)));
  } catch (err) {
    if (err instanceof AggregateError && err.errors.length) {
      const inner = err.errors[0];
      throw inner instanceof Error ? inner : last ?? new Error("網路請求失敗");
    }
    throw last ?? (err instanceof Error ? err : new Error("網路請求失敗"));
  }
}
