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
            name: 'Rules Library', short_name: 'Rules', display: 'standalone',
            background_color: '#111317', theme_color: '#111317',
            icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
          },
          workbox: { globPatterns: ['**/*.{js,css,html,svg}'] },
        }),
  ],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
