import React, { useState, useCallback, useEffect } from "react";
import { AuthClient } from "@dfinity/auth-client";
import { HttpAgent } from "@dfinity/agent";
import { idlFactory } from "../../declarations/viewer_backend/viewer_backend.did.js";
import {
  createActor,
  viewer_backend,
  canisterId,
} from "../../declarations/viewer_backend";
import CandidUI from "./CandidUI";

const network = process.env.DFX_NETWORK || "local";

// Resolve the Internet Identity URL for the current network.
function iiUrl() {
  if (network === "ic") return "https://identity.ic0.app";
  const iiCanisterId =
    process.env.CANISTER_ID_INTERNET_IDENTITY || "rdmx6-jaaaa-aaaaa-aaadq-cai";
  return `http://${iiCanisterId}.localhost:4943`;
}

// ── Lightweight hash router ──────────────────────────────────────

function useHashRoute() {
  const [route, setRoute] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

// ── Pages ────────────────────────────────────────────────────────

function HomePage() {
  return (
    <div className="home">
      <div className="home-card">
        <h2>Welcome</h2>
        <p>
          This frontend lets you browse the Northwind sample database stored as
          stable variables in the <code>viewer_backend</code> canister, exposed
          through auto-generated query methods.
        </p>
        <a href="#/admin" className="admin-link">
          Open Admin Panel
        </a>
      </div>
    </div>
  );
}

function AdminPage({ actor, principal, loading, onLogin, onLogout }) {
  return (
    <>
      <nav className="admin-nav">
        <a href="#/">&larr; Back to Home</a>
      </nav>

      {/* Auth bar */}
      <div className="auth-bar">
        {principal ? (
          <>
            <span className="auth-principal" title={principal}>
              Logged in as <code>{principal}</code>
            </span>
            <button className="auth-btn auth-btn-logout" onClick={onLogout}>
              Logout
            </button>
          </>
        ) : (
          <>
            <span className="auth-anon">Anonymous (not authenticated)</span>
            <button
              className="auth-btn auth-btn-login"
              onClick={onLogin}
              disabled={loading}
            >
              {loading ? "Connecting\u2026" : "Login with Internet Identity"}
            </button>
          </>
        )}
      </div>

      {actor ? (
        <CandidUI idlFactory={idlFactory} actor={actor} />
      ) : (
        <div className="connect-bar">
          <p>
            No canister ID detected. Enter the backend canister ID to connect:
          </p>
          <div className="connect-form">
            <input
              type="text"
              placeholder="e.g. bkyz2-fmaaa-aaaaa-qaaaq-cai"
            />
            <button>Connect</button>
          </div>
        </div>
      )}
    </>
  );
}

// ── App ──────────────────────────────────────────────────────────

export default function App() {
  const route = useHashRoute();
  const isAdmin = route === "#/admin";

  const [authClient, setAuthClient] = useState(null);
  const [actor, setActor] = useState(viewer_backend);
  const [principal, setPrincipal] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Create the AuthClient once on mount.
  useEffect(() => {
    AuthClient.create().then(async (client) => {
      setAuthClient(client);
      if (await client.isAuthenticated()) {
        await applyIdentity(client);
      }
    });
  }, []);

  // Build an authenticated actor from the client's identity.
  async function applyIdentity(client) {
    const identity = client.getIdentity();
    const agent = new HttpAgent({ identity });
    if (network !== "ic") {
      await agent.fetchRootKey().catch(console.error);
    }
    const cid =
      canisterId ||
      new URLSearchParams(window.location.search).get("canisterId");
    if (cid) {
      setActor(createActor(cid, { agent }));
    }
    setPrincipal(identity.getPrincipal().toText());
  }

  const login = useCallback(async () => {
    if (!authClient) return;
    setAuthLoading(true);
    try {
      await new Promise((resolve, reject) => {
        authClient.login({
          identityProvider: iiUrl(),
          onSuccess: resolve,
          onError: reject,
        });
      });
      await applyIdentity(authClient);
    } catch (e) {
      console.error("Login failed", e);
    } finally {
      setAuthLoading(false);
    }
  }, [authClient]);

  const logout = useCallback(async () => {
    if (!authClient) return;
    await authClient.logout();
    setPrincipal(null);
    // Revert to the anonymous actor.
    setActor(viewer_backend);
  }, [authClient]);

  return (
    <div className="app">
      <header>
        <h1>Northwind Database Viewer</h1>
        <p className="subtitle">
          Browse the <code>viewer_backend</code> canister — Northwind sample
          data
        </p>
      </header>

      {isAdmin ? (
        <AdminPage
          actor={actor}
          principal={principal}
          loading={authLoading}
          onLogin={login}
          onLogout={logout}
        />
      ) : (
        <HomePage />
      )}
    </div>
  );
}
