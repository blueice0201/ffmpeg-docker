import path from 'path';
import { fileURLToPath } from 'url';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react-swc';
import { nitro } from 'nitro/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const configDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(configDir, './src'),
      '@shared': path.resolve(configDir, '../../packages/shared/src')
    }
  },
  server: {
    port: 3001,
    strictPort: true
  },
  plugins: [
    tanstackRouter({
      autoCodeSplitting: true,
      semicolons: true,
      quoteStyle: 'single'
    }),
    react(),
    tailwindcss(),
    ...nitro({
      builder: 'rolldown',
      serverDir: './',
      devServer: {
        port: 3001
      }
    })
  ]
});
