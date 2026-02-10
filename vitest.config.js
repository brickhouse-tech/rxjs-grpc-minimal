import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    sequence: {
      concurrent: false
    },
    fileParallelism: false,
    include: ['tests/**/*.spec.js'],
    // Enable debug mode to exercise debug callbacks for coverage
    env: {
      DEBUG: 'rxjs-grpc-minimal:*'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.js'],
      exclude: ['src/utils/testHelpers/**'],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80
      }
    }
  }
});
