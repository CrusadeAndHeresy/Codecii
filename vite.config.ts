import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`   → installable offline PWA (dist/)
// `npm run preview:single` → one self-contained HTML file for quick previews (dist-single/)
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'single'
      ? viteSingleFile()
      : VitePWA({
          registerType: 'autoUpdate',
          manifest: {
            name: 'Codecii', short_name: 'Codecii', display: 'standalone',
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
