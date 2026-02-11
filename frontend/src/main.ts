import { Actor, HttpAgent, type Identity } from '@icp-sdk/core/agent';
import { IDL, renderInput } from '@icp-sdk/core/candid';
import type { InputBox } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { AuthClient } from '@icp-sdk/auth/client';
// @ts-ignore – virtual module: text content of the .did file produced by the Motoko compiler
import candidSource from 'virtual:backend-did';

const APP_NAME = 'Motoko Stable Viewer';
const II_CANISTER_ID = 'rdmx6-jaaaa-aaaaa-aaadq-cai'; // Internet Identity on mainnet; for local use dfx canister id internet_identity

/**
 * True when the app is served locally (dev).
 * Works for: localhost, 127.0.0.1, <canister-id>.localhost, Vite dev server, etc.
 */
function isLocalReplica(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  // Any flavour of localhost / loopback, including *.localhost (dfx pattern)
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]' ||
    h.endsWith('.localhost')
  ) return true;
  // Known local-only ports
  const p = window.location.port;
  if (p === '4943' || p === '5173' || p === '5174') return true;
  return false;
}

/**
 * Agent host URL.
 *  - Local dev (Vite): use page origin – Vite proxy forwards /api to the replica.
 *  - Local (asset canister on replica): use page origin – it IS the replica.
 *  - Mainnet: use the IC boundary nodes.
 */
function getHost(): string {
  if (isLocalReplica()) {
    // Always use current page origin. In the Vite dev server the proxy
    // forwards /api/* to the local replica, so this just works.
    return window.location.origin;
  }
  return 'https://icp-api.io';
}

function getIICanisterId(): string {
  if (isLocalReplica()) {
    return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_II_CANISTER_ID ?? 'rdmx6-jaaaa-aaaaa-aaadq-cai';
  }
  return II_CANISTER_ID;
}

type AppState = {
  authClient: AuthClient | null;
  identity: Identity | null;
  agent: HttpAgent | null;
  canisterId: Principal | null;
  service: ReturnType<IDL.InterfaceFactory> | null;
  idlFactory: IDL.InterfaceFactory | null;
  error: string | null;
};

const state: AppState = {
  authClient: null,
  identity: null,
  agent: null,
  canisterId: null,
  service: null,
  idlFactory: null,
  error: null,
};

async function loadBackendIdl(): Promise<IDL.InterfaceFactory> {
  try {
    const mod = await import('@backend-idl');
    const idlFactory = mod.idlFactory as IDL.InterfaceFactory;
    if (!idlFactory || typeof idlFactory !== 'function') {
      throw new Error('Backend idl did not export idlFactory. Run: dfx build viewer_backend');
    }
    return idlFactory;
  } catch (e) {
    throw new Error(
      'Could not load backend Candid. Build the canister first: dfx build viewer_backend (then ensure .dfx/local/canisters/viewer_backend/viewer_backend.did.js exists, or run dfx generate viewer_backend and point alias to that path).'
    );
  }
}

async function initAuth(): Promise<AuthClient> {
  const authClient = await AuthClient.create();
  return authClient;
}

async function ensureAgent(): Promise<HttpAgent> {
  if (state.agent) return state.agent;
  const identity = state.identity ?? undefined;
  const local = isLocalReplica();
  const agent = await HttpAgent.create({
    host: getHost(),
    identity,
    // Local replica uses a different root key – must fetch it, otherwise
    // the agent defaults to the mainnet root key and calls fail.
    shouldFetchRootKey: local,
  });
  state.agent = agent;
  return agent;
}

/**
 * Unwrap RecClass to get the underlying type.
 */
function unwrapIdlType(ty: IDL.Type): IDL.Type {
  while (ty instanceof IDL.RecClass) {
    const inner = ty.getType();
    if (!inner) break;
    ty = inner;
  }
  return ty;
}

/**
 * True when the IDL type should be rendered as a single inline value (no expand/collapse).
 */
function isIdlPrimitive(ty: IDL.Type): boolean {
  const t = unwrapIdlType(ty);
  return (
    t instanceof IDL.BoolClass ||
    t instanceof IDL.NullClass ||
    t instanceof IDL.TextClass ||
    t instanceof IDL.IntClass ||
    t instanceof IDL.NatClass ||
    t instanceof IDL.FloatClass ||
    t instanceof IDL.FixedIntClass ||
    t instanceof IDL.FixedNatClass ||
    t instanceof IDL.PrincipalClass ||
    t instanceof IDL.EmptyClass ||
    t instanceof IDL.ReservedClass
  );
}

/**
 * Render a primitive Candid value as a styled inline element.
 */
function renderIdlPrimitive(val: unknown, ty: IDL.Type): HTMLElement {
  const t = unwrapIdlType(ty);
  const span = document.createElement('span');

  if (t instanceof IDL.TextClass) {
    span.className = 'inspector-value type-string';
    span.textContent = `"${val}"`;
  } else if (t instanceof IDL.BoolClass) {
    span.className = 'inspector-value type-boolean';
    span.textContent = String(val);
  } else if (t instanceof IDL.NatClass || t instanceof IDL.IntClass || t instanceof IDL.FixedNatClass || t instanceof IDL.FixedIntClass) {
    span.className = 'inspector-value type-bigint';
    span.textContent = String(val);
  } else if (t instanceof IDL.FloatClass) {
    span.className = 'inspector-value type-number';
    span.textContent = String(val);
  } else if (t instanceof IDL.PrincipalClass) {
    span.className = 'inspector-value type-Principal';
    span.textContent = val instanceof Principal ? val.toText() : String(val);
  } else if (t instanceof IDL.NullClass) {
    span.className = 'inspector-value type-null';
    span.textContent = 'null';
  } else {
    span.className = 'inspector-value type-undefined';
    span.textContent = String(val);
  }

  return span;
}

/**
 * Renders a Candid value guided by its IDL type.
 *
 * - Vec<Record>  → table (columns = record field names)
 * - Vec<Tuple>   → table (columns = tuple component indices)
 * - Vec<prim>    → single-column table
 * - Record       → key/value list
 * - Tuple        → indexed list
 * - Variant      → shows the active tag
 * - Opt          → shows presence / absence
 * - Primitives   → inline coloured text
 */
function renderValueInspector(value: unknown, container: HTMLElement, retTypes: IDL.Type[]): void {
  container.innerHTML = '';
  container.className = 'value-inspector';

  // Single return value (most common) – unwrap
  if (retTypes.length === 0) {
    const emptyNode = document.createElement('div');
    emptyNode.className = 'inspector-value type-null';
    emptyNode.textContent = '()';
    container.appendChild(emptyNode);
    return;
  }

  if (retTypes.length === 1) {
    container.appendChild(renderTypedValue(value, retTypes[0], 0));
    return;
  }

  // Multiple return values – render as a tuple-style list
  const values = value as unknown[];
  retTypes.forEach((ty, i) => {
    const row = document.createElement('div');
    row.className = 'inspector-node';
    const keyEl = document.createElement('span');
    keyEl.className = 'inspector-key';
    keyEl.textContent = `[${i}]: `;
    row.appendChild(keyEl);
    row.appendChild(renderTypedValue(values[i], ty, 0));
    container.appendChild(row);
  });

  /**
   * Render a single value guided by its IDL type.
   */
  function renderTypedValue(val: unknown, ty: IDL.Type, depth: number): HTMLElement {
    const t = unwrapIdlType(ty);

    // ── Primitives ──────────────────────────────────────────────
    if (isIdlPrimitive(t)) {
      return renderIdlPrimitive(val, t);
    }

    // ── Opt<T> ──────────────────────────────────────────────────
    if (t instanceof IDL.OptClass) {
      const arr = val as unknown[];
      if (arr.length === 0) {
        const span = document.createElement('span');
        span.className = 'inspector-value type-null';
        span.textContent = 'null';
        return span;
      }
      // Render the inner value with a subtle ?-prefix
      const wrap = document.createElement('span');
      const label = document.createElement('span');
      label.className = 'inspector-type';
      label.textContent = '? ';
      wrap.appendChild(label);
      wrap.appendChild(renderTypedValue(arr[0], t._type, depth));
      return wrap;
    }

    // ── Variant ─────────────────────────────────────────────────
    if (t instanceof IDL.VariantClass) {
      const obj = val as Record<string, unknown>;
      const activeTag = Object.keys(obj)[0];
      const activeVal = obj[activeTag];
      const fieldType = t._fields.find(([name]) => name === activeTag)?.[1];

      const wrap = document.createElement('span');
      const tagEl = document.createElement('span');
      tagEl.className = 'inspector-variant-tag';
      tagEl.textContent = `#${activeTag}`;
      wrap.appendChild(tagEl);

      // If the payload is non-null, render it
      if (fieldType && !(fieldType instanceof IDL.NullClass)) {
        const sep = document.createTextNode(' ');
        wrap.appendChild(sep);
        wrap.appendChild(renderTypedValue(activeVal, fieldType, depth));
      }
      return wrap;
    }

    // ── Vec<T> ──────────────────────────────────────────────────
    if (t instanceof IDL.VecClass) {
      return renderVec(val as unknown[], t, depth);
    }

    // ── Record ──────────────────────────────────────────────────
    if (t instanceof IDL.TupleClass) {
      return renderTuple(val as unknown[], t, depth);
    }

    if (t instanceof IDL.RecordClass) {
      return renderRecord(val as Record<string, unknown>, t, depth);
    }

    // ── Fallback ────────────────────────────────────────────────
    const span = document.createElement('span');
    span.className = 'inspector-value';
    span.textContent = typeof val === 'bigint' ? String(val) : JSON.stringify(val, (_, v) => (typeof v === 'bigint' ? String(v) : v), 2);
    return span;
  }

  /**
   * Render a Vec. Uses a table when the element type is a Record or Tuple.
   */
  function renderVec(arr: unknown[], vecType: IDL.VecClass<unknown>, depth: number): HTMLElement {
    const elemType = unwrapIdlType(vecType._type);

    if (arr.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'inspector-empty';
      empty.textContent = '[]';
      return empty;
    }

    // Vec<Record> → table with field-name columns
    if (elemType instanceof IDL.RecordClass && !(elemType instanceof IDL.TupleClass)) {
      return renderRecordTable(arr as Record<string, unknown>[], elemType, depth);
    }

    // Vec<Tuple> → table with numeric columns
    if (elemType instanceof IDL.TupleClass) {
      return renderTupleTable(arr as unknown[][], elemType, depth);
    }

    // Vec<primitive> → simple single-column table
    if (isIdlPrimitive(elemType)) {
      return renderPrimitiveTable(arr, elemType);
    }

    // Vec<Vec<...>>, Vec<Variant>, etc. – collapsible list
    return renderCollapsibleList(arr, elemType, depth);
  }

  /**
   * Table for Vec<Record>.
   */
  function renderRecordTable(arr: Record<string, unknown>[], recType: IDL.RecordClass, depth: number): HTMLElement {
    const fields = recType._fields; // Array<[string, Type]>
    const table = document.createElement('table');
    table.className = 'inspector-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    fields.forEach(([name, fType]) => {
      const th = document.createElement('th');
      th.textContent = name;
      th.title = unwrapIdlType(fType).name;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    arr.forEach(item => {
      const tr = document.createElement('tr');
      fields.forEach(([name, fType]) => {
        const td = document.createElement('td');
        td.appendChild(renderTypedValue(item[name], fType, depth + 1));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  /**
   * Table for Vec<Tuple>.
   */
  function renderTupleTable(arr: unknown[][], tupleType: IDL.TupleClass<unknown[]>, depth: number): HTMLElement {
    const components = tupleType._fields; // [["_0_", T0], ["_1_", T1], ...]
    const table = document.createElement('table');
    table.className = 'inspector-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    components.forEach(([, cType], i) => {
      const th = document.createElement('th');
      th.textContent = String(i);
      th.title = unwrapIdlType(cType).name;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    arr.forEach(row => {
      const tr = document.createElement('tr');
      components.forEach(([fieldName, cType], i) => {
        const td = document.createElement('td');
        // Tuples decode as arrays
        const v = Array.isArray(row) ? row[i] : (row as Record<string, unknown>)[fieldName];
        td.appendChild(renderTypedValue(v, cType, depth + 1));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  /**
   * Simple single-column table for Vec<primitive>.
   */
  function renderPrimitiveTable(arr: unknown[], elemType: IDL.Type): HTMLElement {
    const table = document.createElement('table');
    table.className = 'inspector-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = unwrapIdlType(elemType).name;
    headerRow.appendChild(th);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    arr.forEach(item => {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.appendChild(renderIdlPrimitive(item, elemType));
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  /**
   * Collapsible list for Vec of non-tabular element types.
   */
  function renderCollapsibleList(arr: unknown[], elemType: IDL.Type, depth: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'inspector-node';

    const header = document.createElement('div');
    header.className = 'inspector-header';
    header.style.cursor = 'pointer';

    const toggle = document.createElement('span');
    toggle.className = 'inspector-toggle collapsed';
    toggle.textContent = '▶';

    const typeEl = document.createElement('span');
    typeEl.className = 'inspector-type type-array';
    typeEl.textContent = `Vec(${arr.length})`;

    header.appendChild(toggle);
    header.appendChild(typeEl);
    wrap.appendChild(header);

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'inspector-children';
    childrenContainer.style.display = 'none';

    header.onclick = (e) => {
      e.stopPropagation();
      const isCollapsed = toggle.classList.contains('collapsed');
      if (isCollapsed && childrenContainer.children.length === 0) {
        arr.forEach((item, i) => {
          const row = document.createElement('div');
          row.className = 'inspector-node';
          row.style.paddingLeft = `${(depth + 1) * 16}px`;
          const keyEl = document.createElement('span');
          keyEl.className = 'inspector-key';
          keyEl.textContent = `[${i}]: `;
          row.appendChild(keyEl);
          row.appendChild(renderTypedValue(item, elemType, depth + 1));
          childrenContainer.appendChild(row);
        });
      }
      toggle.classList.toggle('collapsed');
      toggle.textContent = isCollapsed ? '▼' : '▶';
      childrenContainer.style.display = isCollapsed ? 'block' : 'none';
    };

    wrap.appendChild(childrenContainer);
    return wrap;
  }

  /**
   * Render a Record as a key/value list.
   */
  function renderRecord(val: Record<string, unknown>, recType: IDL.RecordClass, depth: number): HTMLElement {
    const fields = recType._fields;
    const wrap = document.createElement('div');
    wrap.className = 'inspector-node';

    const header = document.createElement('div');
    header.className = 'inspector-header';
    header.style.cursor = 'pointer';

    const toggle = document.createElement('span');
    toggle.className = 'inspector-toggle collapsed';
    toggle.textContent = '▶';

    const typeEl = document.createElement('span');
    typeEl.className = 'inspector-type type-object';
    typeEl.textContent = `{${fields.length}}`;

    header.appendChild(toggle);
    header.appendChild(typeEl);
    wrap.appendChild(header);

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'inspector-children';
    childrenContainer.style.display = 'none';

    header.onclick = (e) => {
      e.stopPropagation();
      const isCollapsed = toggle.classList.contains('collapsed');
      if (isCollapsed && childrenContainer.children.length === 0) {
        fields.forEach(([name, fType]) => {
          const row = document.createElement('div');
          row.className = 'inspector-node';
          row.style.paddingLeft = `${(depth + 1) * 16}px`;
          const keyEl = document.createElement('span');
          keyEl.className = 'inspector-key';
          keyEl.textContent = `${name}: `;
          row.appendChild(keyEl);
          row.appendChild(renderTypedValue(val[name], fType, depth + 1));
          childrenContainer.appendChild(row);
        });
      }
      toggle.classList.toggle('collapsed');
      toggle.textContent = isCollapsed ? '▼' : '▶';
      childrenContainer.style.display = isCollapsed ? 'block' : 'none';
    };

    wrap.appendChild(childrenContainer);
    return wrap;
  }

  /**
   * Render a Tuple as an indexed list.
   */
  function renderTuple(val: unknown[], tupleType: IDL.TupleClass<unknown[]>, depth: number): HTMLElement {
    const components = tupleType._fields;
    const wrap = document.createElement('div');
    wrap.className = 'inspector-node';

    const header = document.createElement('div');
    header.className = 'inspector-header';
    header.style.cursor = 'pointer';

    const toggle = document.createElement('span');
    toggle.className = 'inspector-toggle collapsed';
    toggle.textContent = '▶';

    const typeEl = document.createElement('span');
    typeEl.className = 'inspector-type type-array';
    typeEl.textContent = `Tuple(${components.length})`;

    header.appendChild(toggle);
    header.appendChild(typeEl);
    wrap.appendChild(header);

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'inspector-children';
    childrenContainer.style.display = 'none';

    header.onclick = (e) => {
      e.stopPropagation();
      const isCollapsed = toggle.classList.contains('collapsed');
      if (isCollapsed && childrenContainer.children.length === 0) {
        components.forEach(([fieldName, cType], i) => {
          const row = document.createElement('div');
          row.className = 'inspector-node';
          row.style.paddingLeft = `${(depth + 1) * 16}px`;
          const keyEl = document.createElement('span');
          keyEl.className = 'inspector-key';
          keyEl.textContent = `${i}: `;
          row.appendChild(keyEl);
          const v = Array.isArray(val) ? val[i] : (val as Record<string, unknown>)[fieldName];
          row.appendChild(renderTypedValue(v, cType, depth + 1));
          childrenContainer.appendChild(row);
        });
      }
      toggle.classList.toggle('collapsed');
      toggle.textContent = isCollapsed ? '▼' : '▶';
      childrenContainer.style.display = isCollapsed ? 'block' : 'none';
    };

    wrap.appendChild(childrenContainer);
    return wrap;
  }
}

function renderMethodSection(
  methodName: string,
  func: { argTypes: IDL.Type[]; retTypes: IDL.Type[]; annotations: string[] },
  container: HTMLElement,
  actor: Record<string, (...args: unknown[]) => Promise<unknown>>,
): void {
  const isQuery = func.annotations.includes('query') || func.annotations.includes('composite_query');
  const section = document.createElement('div');
  section.className = 'method-section';
  const title = document.createElement('h3');
  title.textContent = methodName;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = isQuery ? 'query' : 'update';
  title.appendChild(badge);
  section.appendChild(title);

  const formRow = document.createElement('div');
  formRow.className = 'form-row';
  const inputBoxes: InputBox[] = [];
  for (let i = 0; i < func.argTypes.length; i++) {
    const argType = func.argTypes[i];
    const label = document.createElement('label');
    label.textContent = `arg${i}`;
    const wrap = document.createElement('span');
    const input = renderInput(argType);
    inputBoxes.push(input);
    input.render(wrap);
    formRow.appendChild(label);
    formRow.appendChild(wrap);
  }
  section.appendChild(formRow);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const randomBtn = document.createElement('button');
  randomBtn.textContent = 'Random';
  randomBtn.type = 'button';
  randomBtn.onclick = () => {
    for (const box of inputBoxes) {
      box.parse({ random: true });
    }
  };
  const callBtn = document.createElement('button');
  callBtn.className = 'primary';
  callBtn.textContent = isQuery ? 'Query' : 'Call';
  callBtn.type = 'button';

  const resultEl = document.createElement('pre');
  resultEl.className = 'result';
  resultEl.style.display = 'none';

  const methodFn = actor[methodName];
  if (typeof methodFn !== 'function') {
    resultEl.style.display = 'block';
    resultEl.className = 'result error';
    resultEl.textContent = 'Method not found on actor.';
    section.appendChild(actions);
    section.appendChild(resultEl);
    container.appendChild(section);
    return;
  }

  callBtn.onclick = async () => {
    const values: unknown[] = [];
    for (const box of inputBoxes) {
      const v = box.parse();
      if (box.isRejected?.() ?? (v === undefined && box.value === undefined)) {
        resultEl.style.display = 'block';
        resultEl.className = 'result error';
        resultEl.textContent = 'Invalid input for one or more arguments.';
        return;
      }
      values.push(v ?? box.value);
    }
    try {
      callBtn.disabled = true;
      resultEl.style.display = 'block';
      resultEl.className = 'result';
      resultEl.textContent = 'Calling…';
      const result = await methodFn(...values);
      resultEl.innerHTML = '';
      resultEl.classList.add('success');
      renderValueInspector(result, resultEl, func.retTypes);
    } catch (err) {
      resultEl.innerHTML = '';
      resultEl.className = 'result error';
      resultEl.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      callBtn.disabled = false;
    }
  };

  actions.appendChild(randomBtn);
  actions.appendChild(callBtn);
  section.appendChild(actions);
  section.appendChild(resultEl);
  container.appendChild(section);
}

async function renderApp(root: HTMLElement): Promise<void> {
  root.innerHTML = '';

  const header = document.createElement('header');
  const h1 = document.createElement('h1');
  h1.textContent = APP_NAME;
  header.appendChild(h1);

  const authSection = document.createElement('div');
  authSection.className = 'auth-section';
  const loginBtn = document.createElement('button');
  loginBtn.className = 'primary';
  loginBtn.textContent = 'Login with Internet Identity';
  const logoutBtn = document.createElement('button');
  logoutBtn.textContent = 'Logout';
  logoutBtn.style.display = 'none';
  const principalEl = document.createElement('span');
  principalEl.className = 'principal';
  principalEl.title = '';

  async function updateAuthUI(): Promise<void> {
    if (!state.authClient) return;
    const isLoggedIn = await state.authClient.isAuthenticated();
    if (isLoggedIn) {
      state.identity = await state.authClient.getIdentity();
      state.agent = null;
      principalEl.textContent = state.identity.getPrincipal().toText();
      principalEl.title = state.identity.getPrincipal().toText();
      loginBtn.style.display = 'none';
      logoutBtn.style.display = 'inline-block';
    } else {
      state.identity = null;
      state.agent = null;
      principalEl.textContent = '';
      loginBtn.style.display = 'inline-block';
      logoutBtn.style.display = 'none';
    }
    if (state.service && state.canisterId && state.idlFactory) {
      const agent = await ensureAgent();
      const actor = Actor.createActor(state.idlFactory, { agent, canisterId: state.canisterId }) as Record<string, (...args: unknown[]) => Promise<unknown>>;
      const methodsContainer = root.querySelector('#methods');
      if (methodsContainer) {
        methodsContainer.innerHTML = '';
        const service = state.service as { _fields: [string, { argTypes: IDL.Type[]; retTypes: IDL.Type[]; annotations: string[] }][] };
        for (const [methodName, func] of service._fields) {
          renderMethodSection(methodName, func, methodsContainer as HTMLElement, actor);
        }
      }
    }
  }

  loginBtn.onclick = async () => {
    if (!state.authClient) return;
    await new Promise<void>((resolve, reject) => {
      const opts: Parameters<AuthClient['login']>[0] = {
        onSuccess: () => resolve(),
        onError: (err) => reject(err),
      };
      if (isLocalReplica()) {
        opts.identityProvider = `http://${getIICanisterId()}.localhost:4943`;
      }
      state.authClient!.login(opts);
    });
    await updateAuthUI();
  };
  logoutBtn.onclick = async () => {
    if (!state.authClient) return;
    await state.authClient.logout();
    await updateAuthUI();
  };

  authSection.appendChild(principalEl);
  authSection.appendChild(loginBtn);
  authSection.appendChild(logoutBtn);
  header.appendChild(authSection);
  root.appendChild(header);

  // Debug info bar
  const debugBar = document.createElement('div');
  debugBar.className = 'debug-bar';
  const host = getHost();
  const local = isLocalReplica();
  debugBar.innerHTML = [
    `<b>hostname:</b> ${window.location.hostname}`,
    `<b>port:</b> ${window.location.port}`,
    `<b>isLocal:</b> ${local}`,
    `<b>agent host:</b> ${host}`,
    `<b>canister:</b> ${state.canisterId?.toText() ?? '(not set)'}`,
  ].join(' &middot; ');
  root.appendChild(debugBar);

  // Candid interface collapsible section (the .did file produced by the Motoko compiler)
  if (candidSource) {
    const details = document.createElement('details');
    details.className = 'candid-source';
    const summary = document.createElement('summary');
    summary.textContent = 'Candid Interface';
    details.appendChild(summary);
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = candidSource;
    pre.appendChild(code);
    details.appendChild(pre);
    root.appendChild(details);
  }

  if (state.error) {
    const errEl = document.createElement('div');
    errEl.className = 'error';
    errEl.textContent = state.error;
    root.appendChild(errEl);
    return;
  }

  const methodsContainer = document.createElement('div');
  methodsContainer.id = 'methods';
  root.appendChild(methodsContainer);

  if (!state.service || !state.canisterId || !state.idlFactory) {
    methodsContainer.innerHTML = '<div class="loading">Loading backend interface…</div>';
    return;
  }

  const agent = await ensureAgent();
  const actor = Actor.createActor(state.idlFactory, { agent, canisterId: state.canisterId }) as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const service = state.service as { _fields: [string, { argTypes: IDL.Type[]; retTypes: IDL.Type[]; annotations: string[] }][] };
  for (const [methodName, func] of service._fields) {
    renderMethodSection(methodName, func, methodsContainer, actor);
  }

  await updateAuthUI();
}

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;

  try {
    state.authClient = await initAuth();
    await state.authClient.isAuthenticated();
    if (state.authClient && (await state.authClient.isAuthenticated())) {
      state.identity = await state.authClient.getIdentity();
    }
  } catch (e) {
    console.warn('Auth init:', e);
  }

  try {
    state.idlFactory = await loadBackendIdl();
    state.service = state.idlFactory({ IDL });
    const canisterIdStr = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_VIEWER_BACKEND_CANISTER_ID;
    const raw = (canisterIdStr ?? '').trim();
    if (raw) {
      state.canisterId = Principal.fromText(raw);
    } else {
      state.canisterId = null;
      state.error = 'VITE_VIEWER_BACKEND_CANISTER_ID is not set. Set it in frontend/.env (e.g. from: dfx canister id viewer_backend).';
    }
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
  }

  await renderApp(root);
}

main();
