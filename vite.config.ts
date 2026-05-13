import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {visualizer} from 'rollup-plugin-visualizer';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Gera dist/stats.html após o build com mapa do bundle.
      // Roda só em build, não em dev. Acessível via: open dist/stats.html
      mode === 'production' && visualizer({
        filename: 'dist/stats.html',
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
      }),
    ].filter(Boolean),
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        // Ignora sessões do WhatsApp para não triggerar HMR a cada arquivo de sessão
        ignored: ['**/sessions/**', '**/node_modules/**', '**/server.ts', '**/baileys-manager.ts', '**/supabase.ts', '**/pipeline-helpers.ts'],
      },
    },
  };
});
