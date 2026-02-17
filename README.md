# Motoko Stable Variable Viewer

A demo [Internet Computer](https://internetcomputer.org/) application that automatically generates a browseable web UI for any Motoko backend canister, powered by a **generic Candid introspection component**.

The Motoko backend declares its data as `persistent actor` stable variables. A custom Motoko branch auto-generates paginated query methods for every stable collection (via `include Views()`). The React frontend discovers those methods at runtime by introspecting the Candid IDL and renders appropriate controls and result views — tables, key–value panels, pagination — without any hand-written per-method code.

## Demo Application

The included backend implements the **Northwind sample database** (the classic Microsoft demo dataset) plus a **Unicode character table**, all stored as Motoko `Map` stable variables:

| Table | Key | Records | Description |
|-------|-----|---------|-------------|
| categories | Nat | 8 | Product categories |
| suppliers | Nat | 10 | Supplier companies |
| employees | Nat | 9 | Employee directory |
| customers | Text | 15 | Customer companies |
| products | Nat | 20 | Product catalog |
| orders | Nat | 20 | Order headers |
| orderDetails | Nat | 40 | Order line items |
| unicode | Nat | 1,112,064 | Every valid Unicode code point with decimal, hex, and character representation |
| summary | — | 1 | Aggregate counts (non-paginated) |

Each `Map`-backed table is automatically exposed as a paginated query method with signature `(opt K, nat) -> (vec (K, V)) query`, where the first argument is an optional cursor key and the second is the page size.

### Internet Identity

The frontend integrates [Internet Identity](https://identity.ic0.app/) for authentication. Users can log in from the Admin Panel; the authenticated principal is forwarded to the backend, enabling future caller-based access control.

## The `CandidUI` Component

`CandidUI` is a **reusable, generic React component** that renders a complete UI for any Candid service. It lives in `src/viewer_frontend/src/CandidUI.jsx` and can be dropped into any dfx React project.

### Usage

```jsx
import CandidUI from "./CandidUI";

<CandidUI idlFactory={idlFactory} actor={actor} />
```

| Prop | Type | Description |
|------|------|-------------|
| `idlFactory` | `({ IDL }) => IDL.Service` | The Candid IDL factory (from `.did.js`) |
| `actor` | `Actor` | A `@dfinity/agent` Actor instance connected to the canister |

### Features

- **Automatic method discovery** — introspects `idlFactory` to enumerate all service methods, their argument types, return types, and annotations (query / update).
- **Tabbed interface** — each method gets its own tab; component state (pagination position, loaded data) is preserved when switching tabs.
- **Pagination detection** — methods matching the pattern `(opt T, nat) -> (vec ...)` are automatically recognised as paginated and receive First / Prev / Next controls with cursor-based navigation.
- **Typed input generation** — renders number inputs for numeric types, text inputs for strings, and handles `opt` wrappers (empty = null).
- **Recursive value rendering** — walks the IDL type tree to choose the best display:
  - `Vec<Record|Tuple>` → HTML table with column headers
  - `Record` → key–value table
  - `Tuple` → indexed key–value table
  - `Variant` → `#tag(value)` display
  - `Opt` → unwrapped or "null"
  - Primitives (`Nat`, `Int`, `Text`, `Bool`, `Principal`, floats) → inline text
- **Column flattening** — when table rows contain nested records or tuples (e.g. a `Map` entry `(Nat, {name: Text; city: Text})`), the inner fields are promoted to top-level columns for a flat, readable table.

## Project Structure

```
├── dfx.json                          # DFX project configuration
├── webpack.config.js                 # Webpack config for the React frontend
├── package.json                      # Root package.json (npm workspaces)
├── src/
│   ├── viewer_backend/
│   │   └── main.mo                   # Motoko backend — Northwind data + Unicode table
│   ├── viewer_frontend/
│   │   ├── package.json              # Frontend dependencies
│   │   └── src/
│   │       ├── index.jsx             # React entry point
│   │       ├── index.html            # HTML template
│   │       ├── App.jsx               # App shell, routing, Internet Identity auth
│   │       ├── App.css               # App-level styles
│   │       ├── CandidUI.jsx          # Generic Candid UI component
│   │       └── CandidUI.css          # CandidUI styles
│   └── declarations/
│       └── viewer_backend/
│           ├── viewer_backend.did.js  # Hand-written Candid IDL factory
│           └── index.js              # Actor creation helper
```

## Prerequisites

- [dfx](https://internetcomputer.org/docs/current/developer-docs/setup/install/) (tested with 0.30.2+)
- Node.js and npm
- **Custom Motoko compiler** — branch `claudio/data-view` on `DFX_MOC_PATH` (provides auto-generated view methods for stable variables)
- **Custom motoko-core** — at the path configured in `dfx.json` → `defaults.build.args` (`--package mycore <path>`); includes `Map` with `add`/`empty`/view support and other base library modules

## Getting Started

1. **Clone and install dependencies:**

   ```bash
   npm install
   ```

2. **Start the local replica:**

   ```bash
   dfx start --background
   ```

3. **Deploy all canisters** (backend, frontend, and Internet Identity):

   ```bash
   dfx deploy
   ```

   The first deploy of the backend may take a moment as it initialises the Unicode table (1.1M entries).

4. **Open the frontend** at the URL printed by `dfx deploy`, or:

   ```bash
   echo "http://$(dfx canister id viewer_frontend).localhost:4943"
   ```

5. Navigate to the **Admin Panel** and optionally log in with Internet Identity to browse the data.

## Development

Run the webpack dev server with hot reload:

```bash
npm start --workspace viewer_frontend
```

The dev server proxies API calls to the local replica at `http://127.0.0.1:4943`.

## Notes

- The `.did.js` IDL factory is hand-written because the auto-generated view methods are produced during desugaring (after type-checking), so `dfx` emits an empty `.did` file. This is expected.
- The `CandidUI` component is fully generic — swap out the backend for any other Motoko canister (or any IC canister with a Candid interface) and it will render the correct UI.
