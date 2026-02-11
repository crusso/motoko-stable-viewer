// uses mycore because dfx ships too old core (could also use mops)
import Map "mo:mycore/Map";
import Set "mo:mycore/Set";
import Nat "mo:mycore/Nat";
import Text "mo:mycore/Text";
import Array "mo:mycore/Array";

// imports generic .view methods for select collections
import Views "views";

persistent actor {

  // declare the view methods
  include Views();

  let map : Map.Map<Nat, Text> = Map.empty();

  for(i in Nat.range(0,10000)) {
    map.add(i, i.toText());
  };

/* generates:
  public query func map(ko: ?Nat, count: Nat) : async [(Nat, Text)] {
     map.view(/*Nat.compare*/)(ko, count);
  };
*/
  // core extension

  let set : Set.Set<Nat> = Set.empty();

/* generates
  public query func set(ko: ?Nat, count: Nat) : async [Nat] {
     set.view(/*Nat.compare*/)(ko, count);
  };
*/

  for(i in Nat.range(0, 10000)) {
    set.add(i);
  };

  let array : [(Nat, Text)] = Array.tabulate(100000, func i = (i, i.toText()));

  /* generates
  public query func array(ko: ?Nat, count: Nat) : async [(Nat, Text)] {
     array.view()(ko, count);
  };
  */

  let textMap : Map.Map<Text, {size : Nat}> = Map.empty();

  for(i in Nat.range(0,10000)) {
    textMap.add(i.toText(), {size = i.toText().size()});
  };

  // shared values we can just display, sans viewer
  var some_variant = #node (#leaf, 0, #leaf);

  let some_record = {a=1;b ="hello"; c = true} ;

  /* generates
  public query func some_variant() : async {#...} {
     some_variant  (*roughly*)
  };

  public query func some_record() : async {...} {
     some_record (*roughly*)
  };
  */

  // stable, non-shared values we can't just display in full, without viewer
  let invisible_array : [[var Nat]] = [];
  /* generates nothing (for now) */

  let some_mutable_record = {var a = 1};
  /* generates nothing (for now) */

}
