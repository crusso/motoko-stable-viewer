/**
 * CandidUI — a reusable React component that renders a generic Candid
 * service UI.  It introspects an IDL factory to discover methods, generates
 * typed input controls, and renders results by walking the IDL type tree
 * (mapping Vec<Record|Tuple> to tables, etc.).
 *
 * Methods whose signature matches (opt T, nat) -> vec ... are detected as
 * paginated and get automatic Next / Prev / First controls.
 *
 * Props:
 *   idlFactory  – the Candid idlFactory function  ({ IDL }) => IDL.Service
 *   actor       – an @icp-sdk/core/agent Actor instance wired to the canister
 *
 * Usage:
 *   <CandidUI idlFactory={idlFactory} actor={actor} />
 */

import React, { useState, useMemo, useCallback } from "react";
import { IDL } from "@icp-sdk/core/candid";
import "./CandidUI.css";

// ── IDL type detection ───────────────────────────────────────────

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

// ── Pagination detection ─────────────────────────────────────────

/** A method is paginated when its signature is (opt T, opt nat) → (vec ...) */
function isPaginatedMethod(method) {
  const { argTypes, retTypes } = method;
  return (
    argTypes.length === 2 &&
    isOpt(argTypes[0]) &&
    isOpt(argTypes[1]) &&
    isIntType(argTypes[1]._type) &&
    retTypes.length > 0 &&
    isVec(retTypes[0])
  );
}

/**
 * Extract the cursor key from the last item in a result page.
 * For Vec<Tuple(K,…)>  → first component
 * For Vec<Record{…}>   → first field whose type matches cursorType
 * For Vec<K>           → the item itself
 */
function extractCursor(retType, lastItem, cursorType) {
  const inner = retType._type;

  if (isTuple(inner)) {
    return Array.isArray(lastItem) ? lastItem[0] : lastItem[inner._fields[0][0]];
  }

  if (isRecord(inner)) {
    const match = inner._fields.find(([, ft]) => ft === cursorType);
    const fieldName = match ? match[0] : inner._fields[0][0];
    return lastItem[fieldName];
  }

  // Simple vec (Vec<nat>, Vec<text>, …)
  return lastItem;
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

  if (isOpt(type)) {
    if (!Array.isArray(value) || value.length === 0) {
      return <span className="cui-null">null</span>;
    }
    return <CandidValue type={type._type} value={value[0]} />;
  }

  if (isVec(type)) {
    const inner = type._type;
    if ((isRecord(inner) || isTuple(inner)) && value.length > 0) {
      return <DataTable type={inner} rows={value} />;
    }
    if (value.length === 0) {
      return <span className="cui-empty">(empty)</span>;
    }
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
    return (
      <DataTable
        type={IDL.Record({ value: inner })}
        rows={value.map((v) => ({ value: v }))}
      />
    );
  }

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

  if (typeof value === "bigint") return <span>{value.toString()}</span>;
  if (typeof value === "boolean")
    return <span>{value ? "true" : "false"}</span>;
  if (value === null) return <span className="cui-null">null</span>;
  return <span>{String(value)}</span>;
}

// ── Table for Vec<Record|Tuple> ──────────────────────────────────

/**
 * Build a flat list of columns from an outer Record/Tuple type.
 * If a field is itself a Record or Tuple its inner fields are promoted to
 * top-level columns so the table reads naturally (e.g. a Map entry
 * `(Nat, {name: Text; city: Text})` becomes columns  0 | name | city
 * rather than  0 | {name, city}  with a nested sub-table).
 */
function flattenColumns(type) {
  const fields = type._fields;
  const outerIsTup = isTuple(type);
  const cols = [];

  for (let i = 0; i < fields.length; i++) {
    const [name, ft] = fields[i];
    const outerHeader = outerIsTup ? String(i) : name;

    // How to pull the outer value out of a row
    const extractOuter = outerIsTup
      ? (row) => (Array.isArray(row) ? row[i] : row[name])
      : (row) => row[name];

    if (isRecord(ft) || isTuple(ft)) {
      // Flatten one level: promote inner fields to columns
      const innerFields = ft._fields;
      const innerIsTup = isTuple(ft);

      for (let j = 0; j < innerFields.length; j++) {
        const [innerName, innerFt] = innerFields[j];
        cols.push({
          header: innerIsTup ? `${outerHeader}.${j}` : innerName,
          type: innerFt,
          extract(row) {
            const outer = extractOuter(row);
            if (outer == null) return undefined;
            return innerIsTup
              ? (Array.isArray(outer) ? outer[j] : outer[innerName])
              : outer[innerName];
          },
        });
      }
    } else {
      cols.push({
        header: outerHeader,
        type: ft,
        extract: extractOuter,
      });
    }
  }

  return cols;
}

function DataTable({ type, rows }) {
  const columns = useMemo(() => flattenColumns(type), [type]);

  return (
    <div className="cui-table-wrap">
      <table className="cui-data-table">
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {columns.map((col, ci) => (
                <td key={ci}>
                  <CandidValue type={col.type} value={col.extract(row)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Paginated method card ────────────────────────────────────────

function PaginatedMethodCard({ actor, method }) {
  const { name, argTypes, retTypes, annotations } = method;
  const cursorType = argTypes[0]._type; // T in Opt(T)
  const retType = retTypes[0];
  const isQuery = annotations.includes("query");
  const sig = `(${argTypes.map((t) => typeLabel(t)).join(", ")}) \u2192 (${retTypes.map((t) => typeLabel(t)).join(", ")})`;

  const [pageSize, setPageSize] = useState("20");
  const [startKey, setStartKey] = useState("");
  const [displayItems, setDisplayItems] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  // Each entry in the stack is { cursor, newStart } so goPrev can
  // replay the fetch with the same semantics that produced that page.
  const [current, setCurrent] = useState({ cursor: null, newStart: true });
  const [cursorStack, setCursorStack] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const parsed = parseInt(pageSize, 10);
  const ps = pageSize.trim() === "" ? null : Math.max(1, parsed || 20);
  const pageNum = cursorStack.length + 1;

  // newStart distinguishes a fresh query (user-specified start or
  // beginning) from a pagination continuation where the backend
  // returns the cursor row again as an overlap to skip.
  const fetchPage = async (cursor, newStart) => {
    if (!actor) return;
    setLoading(true);
    setError(null);
    try {
      const optCursor = cursor === null ? [] : [cursor];

      if (ps === null) {
        const raw = await actor[name](optCursor, []);
        const items = newStart ? raw : raw.slice(1);
        setDisplayItems(items);
        setHasMore(false);
      } else {
        const fetchCount = newStart ? ps + 1 : ps + 2;
        const raw = await actor[name](optCursor, [BigInt(fetchCount)]);

        let items;
        let more;
        if (newStart) {
          items = raw.slice(0, ps);
          more = raw.length > ps;
        } else {
          const rest = raw.slice(1);
          items = rest.slice(0, ps);
          more = rest.length > ps;
        }

        setDisplayItems(items);
        setHasMore(more);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const goFirst = () => {
    const cursor =
      startKey.trim() === "" ? null : convertInput(cursorType, startKey);
    setCurrent({ cursor, newStart: true });
    setCursorStack([]);
    fetchPage(cursor, true);
  };

  const goNext = () => {
    if (!displayItems || displayItems.length === 0) return;
    const lastItem = displayItems[displayItems.length - 1];
    const nextCursor = extractCursor(retType, lastItem, cursorType);
    setCursorStack((prev) => [...prev, current]);
    setCurrent({ cursor: nextCursor, newStart: false });
    fetchPage(nextCursor, false);
  };

  const goPrev = () => {
    if (cursorStack.length === 0) return;
    const prev = cursorStack[cursorStack.length - 1];
    setCursorStack((s) => s.slice(0, -1));
    setCurrent(prev);
    fetchPage(prev.cursor, prev.newStart);
  };

  const loaded = displayItems !== null;

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

      {/* Controls */}
      <div className="cui-method-params">
        <label>
          <span className="cui-param-label">
            start : <code>{typeLabel(cursorType)}</code> (empty = first)
          </span>
          <input
            type={isNumType(cursorType) ? "number" : "text"}
            placeholder="beginning"
            value={startKey}
            onChange={(e) => setStartKey(e.target.value)}
          />
        </label>
        <label>
          <span className="cui-param-label">page size (empty = all)</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="all"
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </label>
        <button onClick={goFirst} disabled={loading}>
          {loading && !loaded ? "Loading\u2026" : loaded ? "Reload" : "Load"}
        </button>
      </div>

      {/* Pagination bar */}
      {loaded && ps !== null && (
        <div className="cui-pager">
          <button
            className="cui-pager-btn"
            onClick={goFirst}
            disabled={loading || pageNum === 1}
            title="First page"
          >
            &laquo; First
          </button>
          <button
            className="cui-pager-btn"
            onClick={goPrev}
            disabled={loading || pageNum === 1}
            title="Previous page"
          >
            &lsaquo; Prev
          </button>
          <span className="cui-pager-info">Page {pageNum}</span>
          <button
            className="cui-pager-btn"
            onClick={goNext}
            disabled={loading || !hasMore}
            title="Next page"
          >
            Next &rsaquo;
          </button>
        </div>
      )}

      {error && <div className="cui-error">{error}</div>}

      {loaded && (
        <div className="cui-result">
          <div className="cui-result-meta">
            {displayItems.length} entries
            {loading && " — loading\u2026"}
          </div>
          <div className="cui-result-body">
            <CandidValue type={retType} value={displayItems} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Generic (non-paginated) method card ──────────────────────────

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

  const [activeTab, setActiveTab] = useState(() =>
    methods.length > 0 ? methods[0].name : null
  );

  const selectTab = useCallback((name) => setActiveTab(name), []);

  const activeMethod = methods.find((m) => m.name === activeTab);

  return (
    <div className="cui-root">
      <div className="cui-tabs" role="tablist">
        {methods.map((m) => (
          <button
            key={m.name}
            role="tab"
            aria-selected={m.name === activeTab}
            className={`cui-tab ${m.name === activeTab ? "cui-tab-active" : ""}`}
            onClick={() => selectTab(m.name)}
          >
            {m.name}
          </button>
        ))}
      </div>

      {methods.map((m) => (
        <div
          key={m.name}
          className="cui-tab-panel"
          role="tabpanel"
          style={{ display: m.name === activeTab ? "block" : "none" }}
        >
          {isPaginatedMethod(m) ? (
            <PaginatedMethodCard actor={actor} method={m} />
          ) : (
            <MethodCard actor={actor} method={m} />
          )}
        </div>
      ))}
    </div>
  );
}
