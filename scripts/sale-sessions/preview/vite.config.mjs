import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'node:path';
export default defineConfig({
  envDir:'/tmp/crm-sale-preview-no-env', envPrefix:'SALE_PREVIEW_',
  plugins:[{name:'isolated-sale-preview',enforce:'pre',resolveId(source){if(source.endsWith('/authFetch'))return path.resolve('scripts/sale-sessions/preview/mock-api.ts');}},react(),tailwind()],
  server:{host:'127.0.0.1',port:3017,strictPort:true,watch:{ignored:['**/private-backups/**','**/workers/**','**/sessions/**']}},
});
