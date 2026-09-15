import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'tideline-source-entry',
    configureServer(server) {
      // index.html is the manually published snapshot; dev always uses source.
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/' || url.pathname === '/index.html') request.url = `/dev.html${url.search}`;
        next();
      });
    },
  }],
  build: {
    copyPublicDir: false,
    // Three.js is intentionally isolated and currently ~131 kB gzip. The
    // loader support adds a few deferred Three exports to this known vendor.
    chunkSizeWarningLimit: 570,
    rollupOptions: {
      input: 'dev.html',
      output: {
        // Stable vendor boundaries improve browser caching between scene edits.
        manualChunks: {
          icons: ['lucide'],
          'three-addons': [
            'three/addons/controls/OrbitControls.js',
            'three/addons/controls/PointerLockControls.js',
            'three/addons/objects/Sky.js',
            'three/addons/objects/Water.js',
            'three/addons/utils/BufferGeometryUtils.js',
          ],
          'three-loaders': ['three/addons/loaders/GLTFLoader.js'],
          'three-core': ['three'],
        },
      },
    },
  },
});
