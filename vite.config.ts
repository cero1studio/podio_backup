import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Intercepta llamadas a /podio-api y las manda a api.podio.com "engañando" al navegador
      '/podio-api': {
        target: 'https://api.podio.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/podio-api/, ''),
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Importante: Podio verifica el Origin
            proxyReq.setHeader('Origin', 'https://podio.com');
          });
        },
      },
      // Intercepta descargas de /podio-files y las manda a files.podio.com
      '/podio-files': {
        target: 'https://files.podio.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/podio-files/, ''),
        secure: false,
         configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
             proxyReq.setHeader('Origin', 'https://podio.com');
          });
        },
      }
    }
  }
})