use std::net::IpAddr;

use axum::Router;
use axum::routing::get;
use clap::Parser;
use tower_http::trace::{self, TraceLayer};
use tracing::Level;
use tracing_subscriber::{EnvFilter, fmt};

mod assets;
mod mailbox;

#[derive(Parser)]
struct Args {
    /// Address to listen on
    #[arg(long, default_value = "127.0.0.1")]
    host: IpAddr,

    /// Port to listen on
    #[arg(long, default_value_t = 8910)]
    port: u16,
}

fn app(state: mailbox::SharedState) -> Router {
    Router::new()
        .route("/alice/mailbox/{id}", get(mailbox::ws_handler))
        .route("/bob/mailbox/{id}", get(mailbox::ws_handler))
        .with_state(state)
        .route("/", get(assets::index))
        .route("/alice", get(assets::app))
        .route("/bob", get(assets::app))
        .route("/{*file}", get(assets::static_handler))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(trace::DefaultMakeSpan::new().level(Level::INFO))
                .on_response(trace::DefaultOnResponse::new().level(Level::INFO)),
        )
}

#[tokio::main]
async fn main() {
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let args = Args::parse();
    let addr = (args.host, args.port);

    let state = mailbox::new_state();

    tracing::info!("listening on http://{}:{}", addr.0, addr.1);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app(state)).await.unwrap();
}
