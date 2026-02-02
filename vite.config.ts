import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const makeZone = env.VITE_MAKE_ZONE || 'eu1.make.com';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api/make': {
            target: `https://${makeZone}`,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/make/, '/api/v2'),
            configure: (proxy, _options) => {
              proxy.on('proxyReq', (proxyReq, req, _res) => {
                // Add Make API key from environment variable
                const makeApiKey = env.VITE_MAKE_API_KEY;
                if (makeApiKey) {
                  proxyReq.setHeader('Authorization', `Token ${makeApiKey}`);
                }
              });
            },
          },
          '/api/conflicts': { target: 'http://localhost:3001', changeOrigin: true },
          '/api/slot-inventory': { target: 'http://localhost:3001', changeOrigin: true },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.API_BASE_URL': JSON.stringify(env.API_BASE_URL || '/api'),
        'process.env.AIRTABLE_API_KEY': JSON.stringify(env.AIRTABLE_API_KEY || ''),
        'process.env.AIRTABLE_BASE_ID': JSON.stringify(env.AIRTABLE_BASE_ID || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      optimizeDeps: {
        include: ['html2canvas', 'dompurify'],
        exclude: []
      }
    };
});
