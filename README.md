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