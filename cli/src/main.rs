#[cfg(unix)]
mod client;
#[cfg(unix)]
mod commands;
#[cfg(unix)]
mod discovery;
#[cfg(unix)]
mod output;

use clap::Parser;

#[cfg(unix)]
#[derive(Parser)]
#[command(name = "obelisk", about = "Obelisk terminal emulator CLI")]
struct Cli {
    /// Output as JSON
    #[arg(long, global = true)]
    json: bool,

    /// Socket path override (default: auto-discover)
    #[arg(long, global = true)]
    socket: Option<String>,

    #[command(subcommand)]
    command: commands::Command,
}

#[cfg(not(unix))]
#[derive(Parser)]
#[command(name = "obelisk", about = "Obelisk terminal emulator CLI")]
struct Cli {}

#[tokio::main]
async fn main() {
    #[cfg(not(unix))]
    {
        eprintln!("IPC not supported on this platform");
        std::process::exit(1);
    }

    #[cfg(unix)]
    {
        let cli = Cli::parse();

        let socket_path = match cli.socket {
            Some(path) => std::path::PathBuf::from(path),
            None => match discovery::find_instance() {
                Ok(path) => path,
                Err(e) => {
                    eprintln!("Error: {e}");
                    std::process::exit(1);
                }
            },
        };

        match commands::execute(cli.command, &socket_path, cli.json).await {
            Ok(()) => {}
            Err(e) => {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
    }
}
