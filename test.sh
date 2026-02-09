dfx stop
dfx start --background --clean
dfx deploy
#add Candid ui as controller so it can access query methods
#dfx canister update-settings viewer_backend --add-controller $(dfx canister id __Candid_UI)
