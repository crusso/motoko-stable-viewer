import React, { useState, useCallback } from "react";
import {
  viewer_backend,
  createActor,
  canisterId,
} from "../../declarations/viewer_backend";

// Resolve actor: use the pre-created one or prompt for a canister ID
function useBackend() {
  const [actor, setActor] = useState(viewer_backend);
  const [manualId, setManualId] = useState("");

  const connect = useCallback(
    (id) => {
      const cid = id || manualId;
      if (cid) {
        setActor(createActor(cid));
      }
    },
    [manualId]
  );

  return { actor, manualId, setManualId, connect };
}

// ── helpers ──────────────────────────────────────────────────────────

function formatValue(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return JSON.stringify(v, bigintReplacer, 2);
  if (typeof v === "object") return JSON.stringify(v, bigintReplacer, 2);
  return String(v);
}

function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

// ── per-method section ───────────────────────────────────────────────

function PaginatedMethod({ actor, name, offsetLabel, offsetType }) {
  const [offset, setOffset] = useState("");
  const [count, setCount] = useState("20");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const call = async () => {
    if (!actor) return;
    setLoading(true);
    setError(null);
    try {
      const ko =
        offset === ""
          ? []
          : [offsetType === "text" ? offset : BigInt(offset)];
      const res = await actor[name](ko, BigInt(count));
      setResult(res);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="method-card">
      <h3 className="method-name">{name}</h3>
      <div className="method-params">
        <label>
          {offsetLabel}
          <input
            type={offsetType === "text" ? "text" : "number"}
            placeholder="(empty = start)"
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
          />
        </label>
        <label>
          count
          <input
            type="number"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
        <button onClick={call} disabled={loading}>
          {loading ? "Loading…" : "Query"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {result !== null && (
        <div className="result">
          <div className="result-meta">{result.length} entries returned</div>
          <pre>{formatValue(result)}</pre>
        </div>
      )}
    </div>
  );
}

function SimpleMethod({ actor, name }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const call = async () => {
    if (!actor) return;
    setLoading(true);
    setError(null);
    try {
      const res = await actor[name]();
      setResult(res);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="method-card">
      <h3 className="method-name">{name}</h3>
      <div className="method-params">
        <span className="no-params">(no parameters)</span>
        <button onClick={call} disabled={loading}>
          {loading ? "Loading…" : "Query"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {result !== null && (
        <div className="result">
          <pre>{formatValue(result)}</pre>
        </div>
      )}
    </div>
  );
}

// ── main component ───────────────────────────────────────────────────

export default function App() {
  const { actor, manualId, setManualId, connect } = useBackend();

  return (
    <div className="app">
      <header>
        <h1>Stable Variable Viewer</h1>
        <p className="subtitle">
          Query the <code>viewer_backend</code> canister's stable variables
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
            <button onClick={() => connect()}>Connect</button>
          </div>
        </div>
      )}

      {actor && (
        <main>
          <section>
            <h2>Paginated Collections</h2>
            <PaginatedMethod
              actor={actor}
              name="map"
              offsetLabel="ko (key offset)"
              offsetType="nat"
            />
            <PaginatedMethod
              actor={actor}
              name="set"
              offsetLabel="ko (key offset)"
              offsetType="nat"
            />
            <PaginatedMethod
              actor={actor}
              name="array"
              offsetLabel="io (index offset)"
              offsetType="nat"
            />
            <PaginatedMethod
              actor={actor}
              name="textMap"
              offsetLabel="ko (key offset)"
              offsetType="text"
            />
          </section>

          <section>
            <h2>Simple Values</h2>
            <SimpleMethod actor={actor} name="some_record" />
            <SimpleMethod actor={actor} name="some_variant" />
          </section>
        </main>
      )}
    </div>
  );
}
