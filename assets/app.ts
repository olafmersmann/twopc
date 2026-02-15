window.onerror = (message, source, lineno, colno, error) => {
  console.log("ERROR", error);
};

window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  console.log("ERROR", event);
});

import { $, mailboxId, random16 } from "./utils";
import { assert, assertDefined } from "./assert";
import * as c from "./crypto";
import { state, subscribe, update, Role } from "./state";
import { Mailbox } from "./mailbox";

export enum AppState {
  BOTH_COMMITTED,
  BOTH_REVEALED,
  CAN_SEND_COMMITMENT,
  COMMITMENT_SENT,
  CONNECTED,
  FAIL,
  I_COMMITTED,
  I_REVEALED,
  SEND_COMMITMENT_FIRST,
  SEND_COMMITMENT_SECOND,
  SHARED_SECRET,
  START,
  THEY_COMMITTED,
  THEY_REVEALED,
}

enum Event {
  SharedSecretSet,
  PeerConnectionEstablished,
  Committed,
  CommitmentSent,
  CommitmentRecieved,
  RevealSent,
  RevealRecieved,
  Ooops, // Generic error leads to FAIL state
}

interface Transition {
  from: AppState;
  event: Event;
  to: AppState;
}

const transitions: Transition[] = [
  { from: AppState.START, event: Event.SharedSecretSet, to: AppState.SHARED_SECRET },
  { from: AppState.SHARED_SECRET, event: Event.Committed, to: AppState.CAN_SEND_COMMITMENT },
  { from: AppState.SHARED_SECRET, event: Event.PeerConnectionEstablished, to: AppState.CONNECTED },
  { from: AppState.CAN_SEND_COMMITMENT, event: Event.PeerConnectionEstablished, to: AppState.SEND_COMMITMENT_FIRST },
  { from: AppState.SEND_COMMITMENT_FIRST, event: Event.CommitmentSent, to: AppState.I_COMMITTED },
  { from: AppState.CONNECTED, event: Event.Committed, to: AppState.SEND_COMMITMENT_FIRST },
  { from: AppState.CONNECTED, event: Event.CommitmentRecieved, to: AppState.THEY_COMMITTED },
  { from: AppState.I_COMMITTED, event: Event.CommitmentRecieved, to: AppState.BOTH_COMMITTED },
  { from: AppState.THEY_COMMITTED, event: Event.Committed, to: AppState.SEND_COMMITMENT_SECOND },
  { from: AppState.SEND_COMMITMENT_SECOND, event: Event.CommitmentSent, to: AppState.BOTH_COMMITTED },
  { from: AppState.BOTH_COMMITTED, event: Event.RevealSent, to: AppState.I_REVEALED },
  { from: AppState.BOTH_COMMITTED, event: Event.RevealRecieved, to: AppState.THEY_REVEALED },
  { from: AppState.I_REVEALED, event: Event.RevealRecieved, to: AppState.BOTH_REVEALED },
  { from: AppState.THEY_REVEALED, event: Event.RevealSent, to: AppState.BOTH_REVEALED },
];

export function dispatch(event: Event) {
  if (state.appState === null) return;

  const next = transitions.find((t) => t.from === state.appState && t.event === event) ?? {
    from: state.appState,
    event: event,
    to: AppState.FAIL,
  };

  console.debug(`TwoPC FSM: ${AppState[next.from]} -[${Event[next.event]}]-> ${AppState[next.to]} `);
  update({ appState: next.to });
}

async function onEnter(appstate: AppState, action: () => void | Promise<void>) {
  const unsub = subscribe(async (update) => {
    if (update.appState === appstate) {
      const res = action();
      if (res instanceof Promise) {
        return res.catch(() => {});
      }
    }
  });
}

onEnter(AppState.START, async () => {
  const changes: { myRandom: string; sharedSecret?: CryptoKey; role?: Role } = {
    myRandom: random16(),
    role: Role.Alice,
  };

  if (window.location.hash === "") {
    changes.sharedSecret = await c.generateSharedSecret();

    c.encodeUrlSecret(changes.sharedSecret).then((hash) => {
      const url = `${location.origin}/bob#${hash}`;
      const el = $("#share-url", HTMLAnchorElement);
      el.href = url;
      el.textContent = url;
      $("#sec-share").hidden = false;
    });

    if (window.location.pathname.endsWith("bob")) {
      $("#crypto-dysphoria").hidden = false;
    }
  } else {
    changes.sharedSecret = await c.decodeUrlSecret(window.location.hash.slice(1));
    changes.role = Role.Bob;

    if (window.location.pathname.endsWith("alice")) {
      $("#crypto-dysphoria").hidden = false;
    }
  }
  update(changes);
  dispatch(Event.SharedSecretSet);
});

onEnter(AppState.SHARED_SECRET, async () => {
  const { sharedSecret } = state;
  assertDefined(sharedSecret, "Missing shared secret");

  const id = await mailboxId(sharedSecret);
  const role = state.role === Role.Alice ? "alice" : "bob";
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${location.host}/${role}/mailbox/${id}`;

  $("#sec-my-message").hidden = false;
  $("#sec-my-message").scrollIntoView({ behavior: "smooth", block: "center" });

  $("#sec-wait-peer").hidden = false;

  const mailbox = new Mailbox(wsUrl, sharedSecret);

  mailbox.onConnect = () => {
    $("#sec-wait-peer").hidden = true;

    mailbox.onDisconnect = () => {
      $("#reconnect-overlay").hidden = false;
    };
    mailbox.onConnect = () => {
      $("#reconnect-overlay").hidden = true;
    };

    dispatch(Event.PeerConnectionEstablished);
  };

  mailbox.onMessage = (msg: any) => {
    if (msg.type == "commitment") {
      update({ theirCommitment: msg.commitment });
      $("#sec-their-commitment").hidden = false;
      $("#their-commitment", HTMLPreElement).textContent = msg.commitment;

      dispatch(Event.CommitmentRecieved);
    } else if (msg.type == "reveal") {
      update({ theirMessage: msg.message, theirRandom: msg.random });
      dispatch(Event.RevealRecieved);
    }
  };
  update({ mailbox });
});

onEnter(AppState.CAN_SEND_COMMITMENT, async () => {});

onEnter(AppState.SEND_COMMITMENT_FIRST, async () => {
  const { mailbox, myCommitment } = state;
  assertDefined(mailbox, "Missing mailbox");
  assertDefined(myCommitment, "Missing commitment value");

  mailbox.send({ type: "commitment", commitment: myCommitment }).then(() => dispatch(Event.CommitmentSent));
});

onEnter(AppState.SEND_COMMITMENT_SECOND, async () => {
  const { mailbox, myCommitment } = state;
  assertDefined(mailbox, "Missing mailbox");
  assertDefined(myCommitment, "Missing commitment value");

  mailbox.send({ type: "commitment", commitment: myCommitment }).then(() => dispatch(Event.CommitmentSent));
});

onEnter(AppState.BOTH_COMMITTED, async () => {
  const { mailbox, myMessage, myRandom } = state;
  assertDefined(mailbox, "Missing mailbox");
  assertDefined(myMessage, "Missing my message");
  assertDefined(myRandom, "Missing my random value");

  mailbox.send({ type: "reveal", message: myMessage, random: myRandom }).then(() => dispatch(Event.RevealSent));
});

onEnter(AppState.BOTH_REVEALED, async () => {
  const { mailbox, theirCommitment, theirMessage, theirRandom } = state;
  assertDefined(mailbox, "Missing mailbox");
  assertDefined(theirCommitment, "Missing their commitment");
  assertDefined(theirMessage, "Missing their message");
  assertDefined(theirRandom, "Missing their random value");

  mailbox.close();

  c.calculateCommitment(theirMessage, theirRandom).then((checkCommitment) => {
    let verify = $("#sec-verify");
    if (checkCommitment === theirCommitment) {
      verify.classList.add("pass");
      verify.innerHTML = `
        <h1 class="pass">Verification passed</h1>

        <h3>Their message</h3>
        <textarea id="their-message" rows="3" disabled>${theirMessage}</textarea>
        <h3>Their random</h3>
        <pre id="their-random">${theirRandom}</pre>
      `;
    } else {
      verify.classList.add("fail");
      verify.innerHTML = `
        <h1 class="fail">Verification failed</h1>

        <h3>Their message</h3>
        <textarea id="their-message" rows="3" disabled>${theirMessage}</textarea>
        <h3>Their random</h3>
        <pre id="their-random">${theirRandom}</pre>
      `;
    }
    verify.hidden = false;
    verify.scrollIntoView({ behavior: "smooth", block: "center" });
  });
});

onEnter(AppState.FAIL, () => {
  if (state.lastError) {
    $("#error-message").textContent = state.lastError;
  } else {
    $("#error-message").textContent = "Generic error.";
  }
  $("#error-overlay").hidden = false;
});

// ----------------------------------------------
// START OF APPLICATION
// ----------------------------------------------

console.log("Starting application...");

$("#share-url", HTMLAnchorElement).addEventListener("click", (event) => {
  event.preventDefault();
  const url = $("#share-url", HTMLAnchorElement).href;
  navigator.clipboard.writeText(url);
});

$("#commit-btn", HTMLButtonElement).addEventListener("click", (event) => {
  event.preventDefault();
  const { myRandom } = state;
  assertDefined(myRandom, "Missing random");

  for (const child of $("#sec-my-message").querySelectorAll("*")) {
    if ("disabled" in child) {
      (child as HTMLInputElement).disabled = true;
    }
  }

  const myMessage = $("#my-message", HTMLTextAreaElement).value;
  c.calculateCommitment(myMessage, myRandom).then((myCommitment) => {
    $("#sec-my-commitment").hidden = false;
    $("#my-commitment", HTMLPreElement).textContent = myCommitment;

    update({ myMessage, myCommitment });
    dispatch(Event.Committed);
  });
});

update({ appState: AppState.START });
