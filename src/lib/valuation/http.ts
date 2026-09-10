/** Browser-safe GET. GitHub Pages has no server; Yahoo has no CORS. */

const BROWSER = typeof window !== "undefined";

function asResponse(contents: string, contentType: string, code = 200): Response {
  if (code >= 400) throw new Error(`HTTP ${code}`);
  if (/^\s*</.test(contents) && !/^\s*\{/.test(contents) && !/^\s*\[/.test(contents)) {
    throw new Error("代理回了網頁而非資料");
  }
  return new Response(contents, {
    status: 200,
    headers: { "Content-Type": contentType || "application/json" },
  });
}

function unwrapAllorigins(data: unknown): Response {
  const row = (data ?? {}) as {
    contents?: unknown;
    status?: { http_code?: number; content_type?: string };
  };
  const contents =
    typeof row.contents === "string" ? row.contents : JSON.stringify(row.contents ?? "");
  return asResponse(contents, row.status?.content_type || "application/json", row.status?.http_code ?? 200);
}

function jsonpAllorigins(url: string, timeoutMs: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const cb = `hjcb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const script = document.createElement("script");
    let settled = false;
    const finish = (err?: Error, data?: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script.remove();
      try {
        delete (window as unknown as Record<string, unknown>)[cb];
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else {
        try {
          resolve(unwrapAllorigins(data));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }
    };
    const timer = window.setTimeout(() => finish(new Error("代理逾時")), timeoutMs);
    (window as unknown as Record<string, unknown>)[cb] = (data: unknown) => finish(undefined, data);
    script.onerror = () => finish(new Error("代理失敗"));
    script.src = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&callback=${encodeURIComponent(cb)}`;
    document.head.appendChild(script);
  });
}

async function corsGet(url: string, timeoutMs: number): Promise<Response> {
  const res = await fetch(url, {
    method: "GET",
    credentials: "omit",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (/^\s*<!doctype/i.test(text) || /^\s*<html/i.test(text)) {
    throw new Error("代理回了網頁而非資料");
  }
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
  });
}

async function browserGet(url: string): Promise<Response> {
  const encoded = encodeURIComponent(url);
  const errors: string[] = [];
  try {
    return await jsonpAllorigins(url, 16000);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  const fallbacks = [
    () => corsGet(`https://api.allorigins.win/get?url=${encoded}`, 14000).then(async (res) => {
      const data = JSON.parse(await res.text()) as unknown;
      return unwrapAllorigins(data);
    }),
    () => corsGet(`https://corsproxy.io/?${encoded}`, 8000),
    () => corsGet(`https://api.allorigins.win/raw?url=${encoded}`, 10000),
  ];
  for (const run of fallbacks) {
    try {
      return await run();
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(errors[0] || "網路請求失敗");
}

export async function netFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!BROWSER) {
    const res = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
  return browserGet(url);
}
