import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
const profile = process.env.YOURFEED_BUILD_PROFILE || 'cloudflare';
if (!['cloudflare', 'sites'].includes(profile)) throw new Error('YOURFEED_BUILD_PROFILE must be cloudflare or sites');
if (profile === 'sites' && !existsSync('.openai/hosting.json')) throw new Error('Sites builds require a private .openai/hosting.json manifest');
if (profile === 'cloudflare') rmSync('dist/.openai', { recursive: true, force: true });
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
if (!existsSync('dist/server/index.js')) throw new Error('Expected Worker entry dist/server/index.js is missing');
if (profile === 'sites') {
 mkdirSync('dist/.openai', { recursive: true });
 cpSync('.openai/hosting.json', 'dist/.openai/hosting.json');
 if (existsSync('drizzle')) cpSync('drizzle', 'dist/.openai/drizzle', { recursive: true });
}
