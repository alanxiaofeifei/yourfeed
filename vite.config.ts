import { defineConfig } from 'vite';
import vinext from 'vinext';
import { cloudflare } from '@cloudflare/vite-plugin';
import { sites } from '@openai/sites-vite-plugin';

export default defineConfig({
  plugins: [
    vinext(),
    ...(process.env.YOURFEED_BUILD_PROFILE === 'sites' ? [sites()] : []),
    cloudflare({ viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] } }),
  ],
});
