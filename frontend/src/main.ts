import { Actor, HttpAgent, type Identity } from '@icp-sdk/core/agent';
import { IDL, renderInput } from '@icp-sdk/core/candid';
import type { InputBox } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { AuthClient } from '@icp-sdk/auth/client';

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
 * Renders a JavaScript value as an interactive, collapsible tree structure.
 */
function renderValueInspector(value: unknown, container: HTMLElement): void {
  container.innerHTML = '';
  container.className = 'value-inspector';
  
  function getValueType(val: unknown): string {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'bigint') return 'bigint';
    if (val instanceof Principal) return 'Principal';
    if (Array.isArray(val)) return 'Array';
    if (typeof val === 'object') return 'Object';
    return typeof val;
  }

  function createNode(val: unknown, key?: string | number, depth = 0): HTMLElement {
    const node = document.createElement('div');
    node.className = 'inspector-node';
    node.style.paddingLeft = `${depth * 16}px`;

    const type = getValueType(val);
    const isPrimitive = ['string', 'number', 'boolean', 'bigint', 'null', 'undefined'].includes(type);
    const isExpandable = !isPrimitive;

    if (isExpandable) {
      const header = document.createElement('div');
      header.className = 'inspector-header';
      
      const toggle = document.createElement('span');
      toggle.className = 'inspector-toggle collapsed';
      toggle.textContent = '▶';
      
      const keyEl = document.createElement('span');
      keyEl.className = 'inspector-key';
      if (key !== undefined) {
        keyEl.textContent = `${key}: `;
      }
      
      const typeEl = document.createElement('span');
      typeEl.className = `inspector-type type-${type.toLowerCase()}`;
      
      if (type === 'Array') {
        typeEl.textContent = `Array(${(val as unknown[]).length})`;
      } else if (type === 'Object') {
        const keys = Object.keys(val as object);
        typeEl.textContent = keys.length === 0 ? '{}' : `{${keys.length}}`;
      } else if (type === 'Principal') {
        typeEl.textContent = `Principal`;
      }
      
      header.appendChild(toggle);
      header.appendChild(keyEl);
      header.appendChild(typeEl);
      node.appendChild(header);
      
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'inspector-children';
      childrenContainer.style.display = 'none';
      
      header.style.cursor = 'pointer';
      header.onclick = (e) => {
        e.stopPropagation();
        const isCollapsed = toggle.classList.contains('collapsed');
        
        if (isCollapsed && childrenContainer.children.length === 0) {
          // Lazy render children
          if (type === 'Array') {
            (val as unknown[]).forEach((item, i) => {
              childrenContainer.appendChild(createNode(item, i, depth + 1));
            });
          } else if (type === 'Principal') {
            const textNode = document.createElement('div');
            textNode.className = 'inspector-node';
            textNode.style.paddingLeft = `${(depth + 1) * 16}px`;
            const valueEl = document.createElement('span');
            valueEl.className = 'inspector-value type-string';
            valueEl.textContent = `"${(val as Principal).toText()}"`;
            textNode.appendChild(valueEl);
            childrenContainer.appendChild(textNode);
          } else {
            Object.entries(val as object).forEach(([k, v]) => {
              childrenContainer.appendChild(createNode(v, k, depth + 1));
            });
          }
        }
        
        toggle.classList.toggle('collapsed');
        toggle.textContent = isCollapsed ? '▼' : '▶';
        childrenContainer.style.display = isCollapsed ? 'block' : 'none';
      };
      
      node.appendChild(childrenContainer);
    } else {
      // Primitive value
      const line = document.createElement('div');
      line.className = 'inspector-line';
      
      if (key !== undefined) {
        const keyEl = document.createElement('span');
        keyEl.className = 'inspector-key';
        keyEl.textContent = `${key}: `;
        line.appendChild(keyEl);
      }
      
      const valueEl = document.createElement('span');
      valueEl.className = `inspector-value type-${type}`;
      
      if (type === 'string') {
        valueEl.textContent = `"${val}"`;
      } else if (type === 'bigint') {
        valueEl.textContent = `${val}n`;
      } else if (type === 'null' || type === 'undefined') {
        valueEl.textContent = String(val);
      } else {
        valueEl.textContent = String(val);
      }
      
      line.appendChild(valueEl);
      node.appendChild(line);
    }
    
    return node;
  }
  
  if (value === undefined) {
    const emptyNode = document.createElement('div');
    emptyNode.className = 'inspector-value type-undefined';
    emptyNode.textContent = '()';
    container.appendChild(emptyNode);
  } else {
    container.appendChild(createNode(value));
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
      renderValueInspector(result, resultEl);
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
