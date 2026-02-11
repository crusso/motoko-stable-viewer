/**
 * Stub used when the backend has not been built yet.
 * Run: dfx build viewer_backend && dfx generate viewer_backend
 * so that the real .did.js is used (from .dfx or src/declarations).
 */
import { IDL } from '@icp-sdk/core/candid';

export const idlFactory = ({ IDL: Idl }: { IDL: typeof IDL }) =>
  Idl.Service({
    // No methods when using stub
  });

export const init = () => ({});
