import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env variables for the current mode
  const env = loadEnv(mode, process.cwd());

  // Get backend port and host from environment variables or use defaults
  const backendPort = env.VITE_BACKEND_PORT || env.BACKEND_PORT || 3000;
  const backendHost = env.VITE_HOST || env.HOST || 'localhost';

  return {
    plugins: [svelte()],
    server: {
			allowedHosts: ['dev2.manticoresearch.com'],
      fs: {
        allow: ['..']
      },
      proxy: {
        '/api': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path
        }
      }
    }
  };
});
