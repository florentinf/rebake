import { defineConfig } from 'vite';
import { engines } from './build/engines';
import { licenses } from './build/licenses';
import { pages } from './build/pages';
import { serviceWorker } from './build/service-worker';

export default defineConfig({
  plugins: [engines(), pages(), licenses(), serviceWorker()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    sourcemap: false,
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
