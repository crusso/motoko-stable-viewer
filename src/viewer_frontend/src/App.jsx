import React, { useState, useCallback, useEffect } from "react";
import { idlFactory } from "../../declarations/viewer_backend/viewer_backend.did.js";
import { createActor, viewer_backend } from "../../declarations/viewer_backend";
import CandidUI from "./CandidUI";

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
          This frontend lets you inspect the stable variables exposed by the
          <code>viewer_backend</code> canister through its auto-generated query
          methods.
        </p>
        <a href="#/admin" className="admin-link">
          Open Admin Panel
        </a>
      </div>
    </div>
  );
}

function AdminPage({ actor, manualId, setManualId, connect }) {
  return (
    <>
      <nav className="admin-nav">
        <a href="#/">&larr; Back to Home</a>
      </nav>

      {!actor && (
        <div className="connect-bar">
          <p>
            No canister ID detected. Enter the backend canister ID to connect:
          </p>
          <div className="connect-form">
            <input
              type="text"
              placeholder="e.g. bkyz2-fmaaa-aaaaa-qaaaq-cai"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
            />
            <button onClick={connect}>Connect</button>
          </div>
        </div>
      )}

      {actor && <CandidUI idlFactory={idlFactory} actor={actor} />}
    </>
  );
}

// ── App ──────────────────────────────────────────────────────────

export default function App() {
  const route = useHashRoute();
  const [actor, setActor] = useState(viewer_backend);
  const [manualId, setManualId] = useState("");

  const connect = useCallback(() => {
    if (manualId) setActor(createActor(manualId));
  }, [manualId]);

  const isAdmin = route === "#/admin";

  return (
    <div className="app">
      <header>
        <h1>Stable Variable Viewer</h1>
        <p className="subtitle">
          Query the <code>viewer_backend</code> canister
        </p>
      </header>

      {isAdmin ? (
        <AdminPage
          actor={actor}
          manualId={manualId}
          setManualId={setManualId}
          connect={connect}
        />
      ) : (
        <HomePage />
      )}
    </div>
  );
}
