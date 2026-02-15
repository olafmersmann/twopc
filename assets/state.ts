import { Mailbox } from "./mailbox";
import { AppState } from "./app";

export enum Role {
  Alice,
  Bob,
}

export interface State {
  appState: AppState;
  lastError: any;
  role: Role;
  sharedSecret: CryptoKey | null;
  mailbox: Mailbox | null;
  myRandom: string | null;
  myMessage: string | null;
  myCommitment: string | null;
  theirCommitment: string | null;
  theirMessage: string | null;
  theirRandom: string | null;
}

type Listener = (update: Partial<State>) => void;

const listeners = new Set<Listener>();

export const state: State = {
  appState: AppState.START,
  lastError: null,
  role: Role.Alice,
  sharedSecret: null,
  mailbox: null,
  myRandom: null,
  myMessage: null,
  myCommitment: null,
  theirCommitment: null,
  theirMessage: null,
  theirRandom: null,
};

export async function update(partial: Partial<State>) {
  Object.assign(state, partial);
  listeners.forEach((fn) => fn(partial));
}

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function when(condition: () => boolean, action: () => void | Promise<void>) {
  if (condition()) {
    action();
  } else {
    const unsub = subscribe(() => {
      if (condition()) {
        unsub();
        action();
      }
    });
  }
}
