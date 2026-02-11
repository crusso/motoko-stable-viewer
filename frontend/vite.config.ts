import { defineConfig, loadEnv, type Plugin } from 'vite';
import path from 'path';
import { existsSync, readFileSync } from 'fs';

// Backend idl: prefer src/declarations (after dfx generate / dfx deploy), then .dfx (service.did.js), else stub
const declarationsPath = path.resolve(__dirname, '../src/declarations/viewer_backend/viewer_backend.did.js');
const dfxPath = path.resolve(__dirname, '../.dfx/local/canisters/viewer_backend/service.did.js');
const stubPath = path.resolve(__dirname, 'src/stub-backend-idl.ts');
const backendIdlPath = existsSync(declarationsPath) ? declarationsPath : existsSync(dfxPath) ? dfxPath : stubPath;

// Candid .did source file (for display as documentation)
const didFilePath = path.resolve(__dirname, '../src/declarations/viewer_backend/viewer_backend.did');

/**
 * Tiny Vite plugin that serves the .did file content as a virtual module
 * so it can be imported as `import text from 'virtual:backend-did'`.
 */
function backendDidPlugin(): Plugin {
  const virtualId = 'virtual:backend-did';
  const resolvedId = '\0' + virtualId;
  return {
    name: 'backend-did',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id === resolvedId) {
        try {
          const content = readFileSync(didFilePath, 'utf-8');
          return `export default ${JSON.stringify(content)};`;
        } catch {
          return `export default '';`;
        }
      }
    },
  };
}

// Local replica URL
const DFX_REPLICA = 'http://127.0.0.1:4943';

export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, __dirname, '');
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '');
  // Prefer frontend .env, then root .env (dfx writes CANISTER_ID_VIEWER_BACKEND there)
  const backendCanisterId =
    frontendEnv.VITE_VIEWER_BACKEND_CANISTER_ID?.trim() ||
    rootEnv.CANISTER_ID_VIEWER_BACKEND?.trim() ||
    rootEnv.VITE_VIEWER_BACKEND_CANISTER_ID?.trim() ||
    '';

  const iiCanisterId =
    frontendEnv.VITE_II_CANISTER_ID?.trim() ||
    rootEnv.CANISTER_ID_INTERNET_IDENTITY?.trim() ||
    '';

  return {
    root: __dirname,
    // Inject backend canister id from root .env (dfx writes CANISTER_ID_VIEWER_BACKEND there).
    // Inject II canister id for local development.
    define: {
      ...(backendCanisterId
        ? { 'import.meta.env.VITE_VIEWER_BACKEND_CANISTER_ID': JSON.stringify(backendCanisterId) }
        : {}),
      ...(iiCanisterId
        ? { 'import.meta.env.VITE_II_CANISTER_ID': JSON.stringify(iiCanisterId) }
        : {}),
    },
    plugins: [backendDidPlugin()],
    resolve: {
      alias: {
        '@backend-idl': backendIdlPath,
      },
    },
    // Proxy replica API requests so the agent can use the page origin (no cross-origin issues).
    server: {
      proxy: {
        '/api': {
          target: DFX_REPLICA,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
