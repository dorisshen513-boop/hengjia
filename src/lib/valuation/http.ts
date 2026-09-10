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

async function corsGet(url: string, timeoutMs: number): Promise<Response> {
  const res = await fetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
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

async function tryDirect(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (/^\s*<!doctype/i.test(text) || /^\s*<html/i.test(text)) return null;
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  } catch {
    return null;
  }
}

let active = 0;
const waiters: Array<() => void> = [];

async function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 2) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}

async function viaAllorigins(url: string): Promise<Response> {
  const encoded = encodeURIComponent(url);
  try {
    const wrapped = await corsGet(`https://api.allorigins.win/get?url=${encoded}`, 9000);
    return unwrapAllorigins(JSON.parse(await wrapped.text()) as unknown);
  } catch {
    return corsGet(`https://api.allorigins.win/raw?url=${encoded}`, 9000);
  }
}

async function browserGet(url: string): Promise<Response> {
  const canDirect = !/finance\.yahoo\.com|query[12]\.finance|news\.google\.com/i.test(url);
  if (canDirect) {
    const direct = await tryDirect(url);
    if (direct) return direct;
  }
  return enqueue(() => viaAllorigins(url));
}

export async function netFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!BROWSER) {
    const res = await fetch(url, {
      ...init,
      cache: init?.cache ?? "no-store",
      signal: init?.signal ?? AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
  return browserGet(url);
}
