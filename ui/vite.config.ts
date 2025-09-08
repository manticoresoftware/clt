import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env variables for the current mode (including all variables, not just VITE_ prefixed)
  const env = loadEnv(mode, process.cwd(), '');

  // Get backend port and host from environment variables or use defaults
  const backendPort = env.VITE_BACKEND_PORT || env.BACKEND_PORT || 3000;
  const backendHost = env.VITE_HOST || env.HOST || 'localhost';

  // Get Docker image from environment variables
  const dockerImage = env.DOCKER_IMAGE || env.VITE_DOCKER_IMAGE || process.env.DOCKER_IMAGE || null;

  console.log('🐳 Docker image from env:', dockerImage); // Debug log

  return {
    plugins: [svelte()],
    define: {
      // Inject environment variables at build time
      __DEFAULT_DOCKER_IMAGE__: JSON.stringify(dockerImage),
    },
    server: {
			allowedHosts: true,
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
