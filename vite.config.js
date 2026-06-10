import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Same-origin dev proxy for NOAA NDBC, which doesn't send CORS headers (a
  // direct browser fetch is blocked and silently returns []). Routing through
  // the dev server makes the request same-origin; the prod equivalent lives in
  // vercel.json. (airplanes.live sends ACAO:* so flights are fetched directly.)
  server: {
    proxy: {
      '/proxy/ndbc': {
        target: 'https://www.ndbc.noaa.gov',
        changeOrigin: true,
        rewrite: (p) =>
          p.replace(/^\/proxy\/ndbc/, '/data/latest_obs/latest_obs.txt'),
      },
      // RainViewer radar tiles same-origin so throttled (429) responses can't
      // surface as CORS errors during animation.
      '/proxy/rainviewer': {
        target: 'https://tilecache.rainviewer.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/rainviewer/, ''),
      },
    },
  },
});
