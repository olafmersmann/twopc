use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::ws::{Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::Uri;
use axum::response::IntoResponse;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

#[derive(Debug)]
struct Mailbox {
    // alice -> bob channel
    a2b_tx: Option<mpsc::Sender<Utf8Bytes>>,
    a2b_rx: Option<mpsc::Receiver<Utf8Bytes>>,
    // bob -> alice channel
    b2a_tx: Option<mpsc::Sender<Utf8Bytes>>,
    b2a_rx: Option<mpsc::Receiver<Utf8Bytes>>,
}

pub struct MailboxState {
    mailboxes: Mutex<HashMap<String, Mailbox>>,
}

pub type SharedState = Arc<MailboxState>;

pub fn new_state() -> SharedState {
    Arc::new(MailboxState {
        mailboxes: Mutex::new(HashMap::new()),
    })
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    uri: Uri,
    Path(id): Path<String>,
    State(state): State<SharedState>,
) -> impl IntoResponse {
    let role = if uri.path().starts_with("/alice/") {
        "alice"
    } else {
        "bob"
    };
    ws.on_upgrade(move |socket| handle_socket(socket, id, role.to_owned(), state))
}

const RESET_MSG: Utf8Bytes = Utf8Bytes::from_static(r#"{ "type": "reset" }"#);

async fn handle_socket(mut socket: WebSocket, id: String, role: String, state: SharedState) {
    let is_alice = role == "alice";

    let (tx, mut rx) = {
        let mut mailboxes = state.mailboxes.lock().unwrap();
        let mailbox = mailboxes.entry(id.clone()).or_insert_with(|| {
            info!(mailbox = %id, "opened");
            let (a2b_tx, a2b_rx) = mpsc::channel::<Utf8Bytes>(32);
            let (b2a_tx, b2a_rx) = mpsc::channel::<Utf8Bytes>(32);
            Mailbox {
                a2b_tx: Some(a2b_tx),
                a2b_rx: Some(a2b_rx),
                b2a_tx: Some(b2a_tx),
                b2a_rx: Some(b2a_rx),
            }
        });

        let (tx, rx) = if is_alice {
            (mailbox.a2b_tx.take(), mailbox.b2a_rx.take())
        } else {
            (mailbox.b2a_tx.take(), mailbox.a2b_rx.take())
        };

        if tx.is_none() || rx.is_none() {
            warn!(mailbox = %id, role = %role, "role already connected");
            return;
        }

        info!(mailbox = %id, role = %role, "connected");
        (tx.unwrap(), rx.unwrap())
    };

    loop {
        tokio::select! {
            result = socket.recv() => {
                match result {
                    Some(Ok(Message::Text(msg))) => {
                        if tx.send(msg).await.is_err() {
                            warn!(mailbox = %id, role=%role, "tx: could not forward message");
                            break;
                        }
                    },
                    Some(Ok(Message::Close(_))) | None => {
                        if tx.send(RESET_MSG).await.is_err() {
                            warn!(mailbox = %id, role=%role, "tx: could not send CLOSE message");
                        }
                        info!(mailbox=%id, role=%role, "ws: closed");
                        break
                    },
                    Some(Ok(_)) => {},
                    Some(Err(e)) => {
                        warn!(mailbox = %id, role=%role, error=%e, "ws: error");
                        break;
                    }
                }
            }
            result = rx.recv() => {
                match result {
                    Some(msg) => {
                        if let Err(e) = socket.send(Message::Text(msg)).await {
                            warn!(mailbox = %id, role=%role, error=%e, "ws: could not forward message");
                            break;
                        }
                    }
                    None => {
                        error!(mailbox = %id, role=%role, "rx: closed");
                        break;
                    }
                }
            }
        }
    }

    let mut mailboxes = state.mailboxes.lock().unwrap();
    let mailbox = mailboxes.entry(id.clone()).or_insert_with(|| Mailbox {
        a2b_tx: None,
        a2b_rx: None,
        b2a_tx: None,
        b2a_rx: None,
    });
    if is_alice {
        mailbox.a2b_tx = Some(tx);
        mailbox.b2a_rx = Some(rx);
    } else {
        mailbox.b2a_tx = Some(tx);
        mailbox.a2b_rx = Some(rx);
    }
    info!(mailbox = %id, role = %role, mbox=?mailbox, "channels returned to mailbox");
}
