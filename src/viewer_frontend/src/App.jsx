import React, { useState, useCallback, useMemo } from "react";
import { IDL } from "@dfinity/candid";
import { idlFactory } from "../../declarations/viewer_backend/viewer_backend.did.js";
import { createActor, viewer_backend } from "../../declarations/viewer_backend";

// ── IDL type detection ───────────────────────────────────────────
// Obtain constructor references via dummy instances for instanceof checks.

const OptClass = IDL.Opt(IDL.Null).constructor;
const VecClass = IDL.Vec(IDL.Null).constructor;
const RecClass = IDL.Record({}).constructor;
const TupClass = IDL.Tuple(IDL.Null).constructor;
const VarClass = IDL.Variant({ _: IDL.Null }).constructor;

function isOpt(t) {
  return t instanceof OptClass;
}
function isVec(t) {
  return t instanceof VecClass;
}
function isTuple(t) {
  return t instanceof TupClass;
}
function isRecord(t) {
  return t instanceof RecClass && !isTuple(t);
}
function isVariant(t) {
  return t instanceof VarClass;
}

const intTypes = new Set([
  IDL.Nat,
  IDL.Int,
  IDL.Nat8,
  IDL.Nat16,
  IDL.Nat32,
  IDL.Nat64,
  IDL.Int8,
  IDL.Int16,
  IDL.Int32,
  IDL.Int64,
]);
const floatTypes = new Set([IDL.Float32, IDL.Float64]);
function isIntType(t) {
  return intTypes.has(t);
}
function isFloatType(t) {
  return floatTypes.has(t);
}
function isNumType(t) {
  return isIntType(t) || isFloatType(t);
}

// ── IDL type display ─────────────────────────────────────────────

function typeLabel(t) {
  if (isOpt(t)) return `opt ${typeLabel(t._type)}`;
  if (isVec(t)) return `vec ${typeLabel(t._type)}`;
  if (isTuple(t))
    return `record {${t._fields.map(([, ft]) => typeLabel(ft)).join("; ")}}`;
  if (isRecord(t))
    return `record {${t._fields.map(([n, ft]) => `${n}: ${typeLabel(ft)}`).join("; ")}}`;
  if (isVariant(t))
    return `variant {${t._fields.map(([n, ft]) => (ft === IDL.Null ? n : `${n}: ${typeLabel(ft)}`)).join("; ")}}`;
  const names = [
    [IDL.Nat, "nat"],
    [IDL.Int, "int"],
    [IDL.Text, "text"],
    [IDL.Bool, "bool"],
    [IDL.Null, "null"],
    [IDL.Principal, "principal"],
    [IDL.Float32, "float32"],
    [IDL.Float64, "float64"],
    [IDL.Nat8, "nat8"],
    [IDL.Nat16, "nat16"],
    [IDL.Nat32, "nat32"],
    [IDL.Nat64, "nat64"],
    [IDL.Int8, "int8"],
    [IDL.Int16, "int16"],
    [IDL.Int32, "int32"],
    [IDL.Int64, "int64"],
  ];
  for (const [ref, name] of names) {
    if (t === ref) return name;
  }
  return "?";
}

// ── Service introspection ────────────────────────────────────────

function getServiceMethods() {
  const service = idlFactory({ IDL });
  return service._fields.map(([name, func]) => ({
    name,
    argTypes: func.argTypes,
    retTypes: func.retTypes,
    annotations: func.annotations || [],
  }));
}

// ── Input conversion (string → candid value) ────────────────────

function convertInput(type, str) {
  if (isOpt(type)) {
    if (str === "" || str === null || str === undefined) return [];
    return [convertInput(type._type, str)];
  }
  if (isIntType(type)) return BigInt(str);
  if (isFloatType(type)) return Number(str);
  if (type === IDL.Text) return str;
  if (type === IDL.Bool) return str === "true";
  if (type === IDL.Null) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

// ── Generic value renderer ───────────────────────────────────────

function CandidValue({ type, value }) {
  if (value === undefined) {
    return <span className="cv-null">-</span>;
  }

  // Opt
  if (isOpt(type)) {
    if (!Array.isArray(value) || value.length === 0) {
      return <span className="cv-null">null</span>;
    }
    return <CandidValue type={type._type} value={value[0]} />;
  }

  // Vec
  if (isVec(type)) {
    const inner = type._type;
    if ((isRecord(inner) || isTuple(inner)) && value.length > 0) {
      return <DataTable type={inner} rows={value} />;
    }
    if (value.length === 0) {
      return <span className="cv-empty">(empty)</span>;
    }
    // Vec of non-record (primitives, variants, etc.)
    if (isVec(inner) || isRecord(inner) || isTuple(inner)) {
      // Nested complex — render each on its own line
      return (
        <div className="cv-vec-list">
          {value.map((v, i) => (
            <div key={i} className="cv-vec-item">
              <CandidValue type={inner} value={v} />
            </div>
          ))}
        </div>
      );
    }
    // Simple vec — render as a compact table
    return (
      <DataTable
        type={IDL.Record({ _0_: inner })}
        rows={value.map((v) => ({ _0_: v }))}
        headerOverride={["value"]}
      />
    );
  }

  // Record (non-tuple)
  if (isRecord(type)) {
    return (
      <table className="cv-kv-table">
        <tbody>
          {type._fields.map(([name, ft]) => (
            <tr key={name}>
              <th>{name}</th>
              <td>
                <CandidValue type={ft} value={value[name]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Tuple
  if (isTuple(type)) {
    return (
      <table className="cv-kv-table">
        <tbody>
          {type._fields.map(([name, ft], i) => (
            <tr key={name}>
              <th>{i}</th>
              <td>
                <CandidValue
                  type={ft}
                  value={Array.isArray(value) ? value[i] : value[name]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Variant
  if (isVariant(type)) {
    if (typeof value !== "object" || value === null) {
      return <span>{String(value)}</span>;
    }
    const tag = Object.keys(value)[0];
    const fieldDef = type._fields.find(([n]) => n === tag);
    const inner = value[tag];
    const isNull = fieldDef && fieldDef[1] === IDL.Null;
    return (
      <span className="cv-variant">
        <span className="cv-variant-tag">#{tag}</span>
        {!isNull && inner !== null && fieldDef && (
          <span className="cv-variant-body">
            (<CandidValue type={fieldDef[1]} value={inner} />)
          </span>
        )}
      </span>
    );
  }

  // Primitives
  if (typeof value === "bigint") return <span>{value.toString()}</span>;
  if (typeof value === "boolean")
    return <span>{value ? "true" : "false"}</span>;
  if (value === null) return <span className="cv-null">null</span>;
  return <span>{String(value)}</span>;
}

// Table for Vec<Record|Tuple>

function DataTable({ type, rows, headerOverride }) {
  const fields = type._fields;
  const isTup = isTuple(type);
  const headers = headerOverride || fields.map(([name], i) => (isTup ? String(i) : name));

  return (
    <div className="cv-table-wrap">
      <table className="cv-data-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {fields.map(([name, ft], ci) => {
                const cell = isTup
                  ? Array.isArray(row)
                    ? row[ci]
                    : row[name]
                  : row[name];
                return (
                  <td key={ci}>
                    <CandidValue type={ft} value={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Generic method card ──────────────────────────────────────────

function MethodCard({ actor, method }) {
  const { name, argTypes, retTypes, annotations } = method;
  const [args, setArgs] = useState(() => argTypes.map(() => ""));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const call = async () => {
    if (!actor) return;
    setLoading(true);
    setError(null);
    try {
      const converted = argTypes.map((t, i) => convertInput(t, args[i]));
      const res = await actor[name](...converted);
      setResult(res);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const updateArg = (idx, val) => {
    setArgs((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };

  const isQuery = annotations.includes("query");
  const retType = retTypes.length > 0 ? retTypes[0] : null;
  const sig = `(${argTypes.map((t) => typeLabel(t)).join(", ")}) -> (${retTypes.map((t) => typeLabel(t)).join(", ")})`;

  return (
    <div className="method-card">
      <div className="method-header">
        <h3 className="method-name">{name}</h3>
        <span className={`method-badge ${isQuery ? "query" : "update"}`}>
          {isQuery ? "query" : "update"}
        </span>
      </div>
      <div className="method-sig">{sig}</div>

      <div className="method-params">
        {argTypes.map((type, i) => (
          <label key={i}>
            <span className="param-label">
              arg{i} : <code>{typeLabel(type)}</code>
            </span>
            <input
              type={isNumType(type) || (isOpt(type) && isNumType(type._type)) ? "number" : "text"}
              placeholder={isOpt(type) ? "(empty = null)" : typeLabel(type)}
              value={args[i]}
              onChange={(e) => updateArg(i, e.target.value)}
            />
          </label>
        ))}
        {argTypes.length === 0 && (
          <span className="no-params">(no parameters)</span>
        )}
        <button onClick={call} disabled={loading}>
          {loading ? "Loading\u2026" : "Call"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {result !== null && retType && (
        <div className="result">
          {isVec(retType) && Array.isArray(result) && (
            <div className="result-meta">{result.length} entries</div>
          )}
          <div className="result-body">
            <CandidValue type={retType} value={result} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────

export default function App() {
  const methods = useMemo(() => getServiceMethods(), []);
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

      {actor && (
        <main>
          {methods.map((m) => (
            <MethodCard key={m.name} actor={actor} method={m} />
          ))}
        </main>
      )}
    </div>
  );
}
