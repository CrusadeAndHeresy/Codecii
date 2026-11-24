import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';
import pkg from './package.json';

// shown on the About card so you can tell which build a phone is running
const commit = (process.env.CF_PAGES_COMMIT_SHA || (() => { try { return execSync('git rev-parse HEAD').toString(); } catch { return ''; } })()).trim().slice(0, 7);

// `npm run build`   → installable offline PWA (dist/)
// `npm run preview:single` → one self-contained HTML file for quick previews (dist-single/)
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    mode === 'single'
      ? viteSingleFile()
      : VitePWA({
          registerType: 'autoUpdate',
          manifest: {
            name: 'Codecii', short_name: 'Codecii', id: '/', start_url: '/', scope: '/', display: 'standalone', display_override: ['standalone', 'minimal-ui'], orientation: 'portrait',
            background_color: '#111317', theme_color: '#111317',
            icons: [
              { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
            // The list readers (PDF and screenshot) are big; they are kept after first use, not downloaded with the app.
            globIgnores: ['vendor/**'],
            runtimeCaching: [{
              urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/vendor/'),
              handler: 'CacheFirst',
              options: { cacheName: 'readers', cacheableResponse: { statuses: [0, 200] }, expiration: { maxEntries: 40 } },
            }],
          },
        }),
  ],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
