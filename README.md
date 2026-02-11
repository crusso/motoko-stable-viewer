# `viewer`

A simple project to demonstrate implicit query methods for stable variables
Uses v.view() methods when available, e.g. to paginate collections.
Otherwise, if the stable variable v has a shared type,
just returns the shared value (unpaginated).

FUTURE: maybe implicitly force stable to shared via subtyping for convenience.

SPECIAL REQUIREMENTS

* Recent motoko-core in /home/crusso/motoko-core (with self-declarations) (not actually necessary if one rewrite main.mo to avoid dots.
  (edit dfx.json to replace --package mycore <path> with your own <path>
* custom built motoko branch claudio/data-view on DFX_MOC_PATH
* test.sh is meant to make the candid_ui canister a controller of the backend but doesn't have the desired effect for some reason... I currently disable authentication in the motoko branch.

The viewer_backend actor has embedded candid:

```candid
service : {
  array: (io: opt nat, count: nat) -> (vec record {
                                             nat;
                                             text;
                                           }) query;
  map: (ko: opt nat, count: nat) -> (vec record {
                                           nat;
                                           text;
                                         }) query;
  set: (ko: opt nat, count: nat) -> (vec nat) query;
  some_record: () -> (record {
                        a: nat;
                        b: text;
                        c: bool;
                      }) query;
  some_variant: () ->
   (variant {node: record {
                     variant {leaf;};
                     nat;
                     variant {leaf;};
                   };}) query;
  textMap: (ko: opt text, count: nat) ->
   (vec record {
          text;
          record {size: nat;};
        }) query;
}
```

For some reason, the .did dfx produces is actually empty (perhaps because these extra methods are generated in desugaring, after type checking).

Maybe that's a feature, not a bug ;->.

## Frontend (Candid UI + Internet Identity)

A generic Candid UI frontend is in `frontend/`. It uses the **generic rendering class** from `@icp-sdk/core/candid` (`renderInput` / `Render` from [candid-ui](https://github.com/dfinity/icp-js-core/blob/main/packages/core/src/candid/candid-ui.ts)) to build forms for every backend method, and supports **Internet Identity** login so methods are called with an authenticated agent.

### Setup

1. **Build the backend** so the Candid idl is available:
   ```bash
   dfx build viewer_backend
   dfx generate viewer_backend
   ```
   The frontend loads the backend idl from `.dfx/local/canisters/viewer_backend/viewer_backend.did.js` or, if that is missing, from `src/declarations/viewer_backend/viewer_backend.did.js` (created by `dfx generate`).

2. **Configure env** (see `frontend/.env.example`):
   ```bash
   cd frontend
   cp .env.example .env
   # Set VITE_VIEWER_BACKEND_CANISTER_ID=$(dfx canister id viewer_backend)
   # For local II: VITE_II_CANISTER_ID=$(dfx canister id internet_identity)
   ```

3. **Install and run**:
   ```bash
   npm install
   npm run dev
   ```
   Or build and deploy the frontend canister:
   ```bash
   npm run build
   dfx deploy viewer_frontend
   ```

### Features

- **Generic Candid UI**: Renders one section per canister method; each argument uses the `renderInput()` / `Render` visitor from `@icp-sdk/core/candid` (input fields, option/variant/vec/record forms).
- **Random**: Fill arguments with random values for quick testing.
- **Query vs update**: Buttons call the method as query or update as defined in the idl.
- **Internet Identity**: "Login with Internet Identity" creates an authenticated agent; all calls then use that identity. Logout clears it.