// Redirects the legacy reins.karnstack.com host and www.reins.tech to
// reins.tech (path and query preserved), and serves the prerendered site for
// every other host. Requires `run_worker_first` in wrangler.jsonc so asset
// paths hit the redirect too.
const REDIRECT_HOSTS = new Set(["reins.karnstack.com", "www.reins.tech"]);

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (REDIRECT_HOSTS.has(url.hostname)) {
      return Response.redirect(`https://reins.tech${url.pathname}${url.search}`, 301);
    }
    return env.ASSETS.fetch(request);
  },
};
