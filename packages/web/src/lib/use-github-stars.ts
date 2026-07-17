import { useEffect, useState } from "react";

/* Live GitHub star count for the header chip. Cached in localStorage so the
   number paints immediately on repeat visits (no layout shift) and the network
   call only refreshes when the cache is stale. Unauthenticated GitHub API is
   rate-limited per IP, which the cache keeps us well under. */

const REPO = "karnstack/reins";
const CACHE_KEY = "reins:stars";
const MAX_AGE = 6 * 60 * 60 * 1000; // 6h

interface Cache {
  count: number;
  at: number;
}

function readCache(): Cache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cache;
    return typeof parsed.count === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/** Returns the star count, or `null` until it is known. */
export function useGitHubStars(): number | null {
  const [count, setCount] = useState<number | null>(() => readCache()?.count ?? null);

  useEffect(() => {
    const cached = readCache();
    if (cached && Date.now() - cached.at < MAX_AGE) {
      setCount(cached.count);
      return;
    }

    let active = true;
    fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { stargazers_count?: number }) => {
        if (!active || typeof data.stargazers_count !== "number") return;
        setCount(data.stargazers_count);
        try {
          localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ count: data.stargazers_count, at: Date.now() }),
          );
        } catch {
          /* storage full or blocked — the count still shows this session */
        }
      })
      .catch(() => {
        /* offline or rate-limited — keep whatever the cache gave us */
      });

    return () => {
      active = false;
    };
  }, []);

  return count;
}

/** 1234 → "1.2k", 950 → "950". */
export function formatStars(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
}
