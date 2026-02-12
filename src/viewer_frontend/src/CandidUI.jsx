/**
 * CandidUI — a reusable React component that renders a generic Candid
 * service UI.  It introspects an IDL factory to discover methods, generates
 * typed input controls, and renders results by walking the IDL type tree
 * (mapping Vec<Record|Tuple> to tables, etc.).
 *
 * Props:
 *   idlFactory  – the Candid idlFactory function  ({ IDL }) => IDL.Service
 *   actor       – a @dfinity/agent Actor instance wired to the canister
 *
 * Usage:
 *   <CandidUI idlFactory={idlFactory} actor={actor} />
 */

import React, { useState, useMemo } from "react";
import { IDL } from "@dfinity/candid";
import "./CandidUI.css";

// ── IDL type detection ───────────────────────────────────────────
// Obtain constructor references via dummy instances for instanceof checks.

const OptCtor = IDL.Opt(IDL.Null).constructor;
const VecCtor = IDL.Vec(IDL.Null).constructor;
const RecCtor = IDL.Record({}).constructor;
const TupCtor = IDL.Tuple(IDL.Null).constructor;
const VarCtor = IDL.Variant({ _: IDL.Null }).constructor;

function isOpt(t) {
  return t instanceof OptCtor;
}
function isVec(t) {
  return t instanceof VecCtor;
}
function isTuple(t) {
  return t instanceof TupCtor;
}
function isRecord(t) {
  return t instanceof RecCtor && !isTuple(t);
}
function isVariant(t) {
  return t instanceof VarCtor;
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

// ── IDL type → candid-style label ────────────────────────────────

function typeLabel(t) {
  if (isOpt(t)) return `opt ${typeLabel(t._type)}`;
  if (isVec(t)) return `vec ${typeLabel(t._type)}`;
  if (isTuple(t))
    return `record {${t._fields.map(([, ft]) => typeLabel(ft)).join("; ")}}`;
  if (isRecord(t))
    return `record {${t._fields.map(([n, ft]) => `${n}: ${typeLabel(ft)}`).join("; ")}}`;
  if (isVariant(t))
    return `variant {${t._fields.map(([n, ft]) => (ft === IDL.Null ? n : `${n}: ${typeLabel(ft)}`)).join("; ")}}`;
  const prims = [
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
  for (const [ref, name] of prims) {
    if (t === ref) return name;
  }
  return "?";
}

// ── Service introspection ────────────────────────────────────────

function getServiceMethods(factory) {
  const service = factory({ IDL });
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
    return <span className="cui-null">-</span>;
  }

  // Opt
  if (isOpt(type)) {
    if (!Array.isArray(value) || value.length === 0) {
      return <span className="cui-null">null</span>;
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
      return <span className="cui-empty">(empty)</span>;
    }
    // Nested complex types — render each on its own line
    if (isVec(inner) || isRecord(inner) || isTuple(inner)) {
      return (
        <div className="cui-vec-list">
          {value.map((v, i) => (
            <div key={i} className="cui-vec-item">
              <CandidValue type={inner} value={v} />
            </div>
          ))}
        </div>
      );
    }
    // Simple vec — single-column table
    return (
      <DataTable
        type={IDL.Record({ value: inner })}
        rows={value.map((v) => ({ value: v }))}
      />
    );
  }

  // Record (non-tuple)
  if (isRecord(type)) {
    return (
      <table className="cui-kv-table">
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
      <table className="cui-kv-table">
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
      <span className="cui-variant">
        <span className="cui-variant-tag">#{tag}</span>
        {!isNull && inner !== null && fieldDef && (
          <span className="cui-variant-body">
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
  if (value === null) return <span className="cui-null">null</span>;
  return <span>{String(value)}</span>;
}

// ── Table for Vec<Record|Tuple> ──────────────────────────────────

function DataTable({ type, rows }) {
  const fields = type._fields;
  const isTup = isTuple(type);
  const headers = fields.map(([name], i) => (isTup ? String(i) : name));

  return (
    <div className="cui-table-wrap">
      <table className="cui-data-table">
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

// ── Method card ──────────────────────────────────────────────────

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
  const sig = `(${argTypes.map((t) => typeLabel(t)).join(", ")}) \u2192 (${retTypes.map((t) => typeLabel(t)).join(", ")})`;

  return (
    <div className="cui-method-card">
      <div className="cui-method-header">
        <h3 className="cui-method-name">{name}</h3>
        <span
          className={`cui-method-badge ${isQuery ? "cui-badge-query" : "cui-badge-update"}`}
        >
          {isQuery ? "query" : "update"}
        </span>
      </div>
      <div className="cui-method-sig">{sig}</div>

      <div className="cui-method-params">
        {argTypes.map((type, i) => (
          <label key={i}>
            <span className="cui-param-label">
              arg{i} : <code>{typeLabel(type)}</code>
            </span>
            <input
              type={
                isNumType(type) || (isOpt(type) && isNumType(type._type))
                  ? "number"
                  : "text"
              }
              placeholder={isOpt(type) ? "(empty = null)" : typeLabel(type)}
              value={args[i]}
              onChange={(e) => updateArg(i, e.target.value)}
            />
          </label>
        ))}
        {argTypes.length === 0 && (
          <span className="cui-no-params">(no parameters)</span>
        )}
        <button onClick={call} disabled={loading}>
          {loading ? "Loading\u2026" : "Call"}
        </button>
      </div>

      {error && <div className="cui-error">{error}</div>}
      {result !== null && retType && (
        <div className="cui-result">
          {isVec(retType) && Array.isArray(result) && (
            <div className="cui-result-meta">{result.length} entries</div>
          )}
          <div className="cui-result-body">
            <CandidValue type={retType} value={result} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────

export default function CandidUI({ idlFactory, actor }) {
  const methods = useMemo(
    () => getServiceMethods(idlFactory),
    [idlFactory]
  );

  return (
    <div className="cui-root">
      {methods.map((m) => (
        <MethodCard key={m.name} actor={actor} method={m} />
      ))}
    </div>
  );
}
