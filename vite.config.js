import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    copyPublicDir: false,
    // Three.js is intentionally isolated and currently ~131 kB gzip. The
    // loader support adds a few deferred Three exports to this known vendor.
    chunkSizeWarningLimit: 570,
    rollupOptions: {
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
