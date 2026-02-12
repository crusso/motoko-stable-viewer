import React, { useState, useCallback } from "react";
import { idlFactory } from "../../declarations/viewer_backend/viewer_backend.did.js";
import { createActor, viewer_backend } from "../../declarations/viewer_backend";
import CandidUI from "./CandidUI";

export default function App() {
  const [actor, setActor] = useState(viewer_backend);
  const [manualId, setManualId] = useState("");

  const connect = useCallback(() => {
    if (manualId) setActor(createActor(manualId));
  }, [manualId]);

  return (
    <div className="app">
      <header>
        <h1>Stable Variable Viewer</h1>
        <p className="subtitle">
          Query the <code>viewer_backend</code> canister
        </p>
      </header>

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
    </div>
  );
}
