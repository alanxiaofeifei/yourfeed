import framework from 'vinext/server/fetch-handler';
import { handleApi } from '../server/api';
import type { Env } from '../server/db';
import { resolveSession } from '../server/auth';
import { verifyDeploymentChallenge } from '../server/deployment';

export default {
  async scheduled(_event:ScheduledEvent,env:Env,ctx:ExecutionContext):Promise<void>{
    const {runBackground}=await import('../server/background');
    ctx.waitUntil(runBackground(env).then(()=>undefined).catch(()=>{console.warn(JSON.stringify({event:'background_failed'}));}));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, ctx);
    const challenge = url.pathname.match(/^\/\.well-known\/yourfeed-instance\/([a-f0-9]{64})$/)?.[1];
    if (challenge) return verifyDeploymentChallenge(env, challenge);
    // Static client assets contain no private data. Every page and RSC request
    // passes the same server-side session boundary, regardless of its hostname.
    const asset = /^\/(?:assets\/|_next\/static\/|_vinext\/)/.test(url.pathname) || url.pathname === '/favicon.ico';
    if (env.AUTH_MODE !== 'sites' && url.pathname !== '/login' && !asset) {
      const session = await resolveSession(request, env);
      if (!session) return new Response(null, {status: 302, headers: {Location: '/login', 'Cache-Control': 'no-store'}});
    }
    const result = await framework.fetch(request, env, ctx);
    const response = new Response(result.body, result);
    if (!asset) response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return response;
  },
};
