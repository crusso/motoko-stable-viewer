import Map "mo:mycore/Map";
import Set "mo:mycore/Set";
import Nat "mo:mycore/Nat";
import Iter "mo:mycore/Iter";
import Order "mo:mycore/Order";
import Text "mo:mycore/Text";
import Array "mo:mycore/Array";

// custom self.view(...) methods, collected in a mixin for convenience.
mixin () {

  module MapView {
   public func view<K,V>(self : Map.Map<K, V>, compare : (implicit : (K,K) -> Order.Order)) : (ko : ?K, count : Nat) -> [(K, V)] =
      func (ko, count) {
        let entries = switch ko {
      	  case null {
            self.entries()
          };
          case (?k) {
          self.entriesFrom(k)
          };
        };
        entries.take(count).toArray();
     }
  };

  module SetView {

   public func view<K>(
     self : Set.Set<K>,
     compare : (implicit : (K,K) -> Order.Order)) : (
     ko : ?K,
     count : Nat) -> [K] =
     func (ko, count) {
      let entries = switch ko {
        case null {
          self.values()
        };
        case (?k) {
          self.valuesFrom(k)
        };
      };
      entries.take(count).toArray();
    };
  };

  module ArrayView {

   public func view<V>(self : [V]) :
     (io : ?Nat, count : Nat) -> [V] =
     func (io, count) {
       // TODO: use slice instead
       let entries = switch io {
         case null {
           self.values()
         };
         case (?io) {
           self.values().drop(io)
         };
       };
       entries.take(count).toArray();
    };
  };

}
