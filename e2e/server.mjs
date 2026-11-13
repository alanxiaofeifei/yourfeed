import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  cacheDir: root + '../node_modules/.cache/onboarding-e2e',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4175, strictPort: true, fs: { allow: [root + '..'] } },
  logLevel: 'warn',
});
await server.listen();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
