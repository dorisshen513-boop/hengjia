export async function netFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (typeof window !== "undefined") {
    headers.delete("User-Agent");
  }
  const targets =
    typeof window === "undefined"
      ? [url]
      : [
          url,
          `https://corsproxy.io/?${encodeURIComponent(url)}`,
          `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
          `https://cors.eu.org/${url}`,
        ];
  let last: Error | null = null;
  for (const target of targets) {
    try {
      const res = await fetch(target, {
        ...init,
        headers,
        signal: init?.signal ?? AbortSignal.timeout(14000),
      });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw last ?? new Error("網路請求失敗");
}
