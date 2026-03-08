use std::sync::Arc;
use tokio::net::UnixListener;
use tokio::sync::watch;

use super::IpcContext;

pub async fn accept_loop<C: IpcContext + Send + Sync + 'static>(
    listener: UnixListener,
    context: Arc<C>,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            result = listener.accept() => {
                match result {
                    Ok((stream, _addr)) => {
                        let ctx = context.clone();
                        tokio::spawn(async move {
                            super::connection::handle_connection(stream, ctx).await;
                        });
                    }
                    Err(e) => {
                        tracing::error!("Failed to accept connection: {e}");
                    }
                }
            }
            _ = shutdown_rx.changed() => {
                tracing::info!("IPC server shutting down");
                break;
            }
        }
    }
}
