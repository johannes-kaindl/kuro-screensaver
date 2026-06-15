import { defineConfig } from 'vitest/config';

// Unit + cross-platform parity tests for the engine logic (the twin of the
// native assert tests in native/macos/KuroNativeSaver/tests/main.swift).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
