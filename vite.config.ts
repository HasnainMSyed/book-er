import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Book-er',
        short_name: 'Book-er',
        description: 'Read PDFs comfortably on your phone',
        theme_color: '#F3E9D2',
        background_color: '#F3E9D2',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the whole app (including the pdf.js worker, fonts and image
        // decoders) so it works offline. Character maps are only needed for
        // some PDFs, so those are cached the first time they're used.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,wasm,pfb,ttf,icc}'],
        globIgnores: ['pdfjs/cmaps/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/pdfjs/cmaps/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-cmaps', expiration: { maxEntries: 200 } },
          },
        ],
      },
    }),
  ],
})
