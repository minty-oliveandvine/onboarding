// "Has this component mounted in a browser?" -- for portals to document.body.
//
// The one honest reason to know this is server rendering: document.body does not exist
// there, so a portal has to wait for the client. The old shape was a `useState(false)`
// flipped to true in a mount effect, in four separate components. `useSyncExternalStore`
// answers the same question without a state update inside an effect: the server
// snapshot is false, the client snapshot is true, and React swaps them after hydration.

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
