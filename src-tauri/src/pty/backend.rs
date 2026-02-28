use crate::error::PtyError;
use crate::pty::types::PtyConfig;
use std::io::{Read, Write};

/// Abstraction for controlling a child process spawned in a PTY.
pub trait ChildController: Send {
    fn kill(&mut self) -> Result<(), PtyError>;
    fn is_alive(&mut self) -> Result<bool, PtyError>;
}

/// Abstraction for resizing a PTY.
pub trait PtyResizer: Send + Sync {
    fn resize(&self, rows: u16, cols: u16) -> Result<(), PtyError>;
}

/// Bundle of resources returned by a successful PTY spawn.
pub struct SpawnedPty {
    pub writer: Box<dyn Write + Send>,
    pub reader: Box<dyn Read + Send>,
    pub child: Box<dyn ChildController>,
    pub resizer: Box<dyn PtyResizer>,
}

/// Backend trait for spawning PTY processes.
pub trait PtyBackend: Send + Sync {
    fn spawn(&self, config: &PtyConfig) -> Result<SpawnedPty, PtyError>;
}

// --- Real implementations ---

struct RealChildController(Box<dyn portable_pty::Child + Send + Sync>);

impl ChildController for RealChildController {
    fn kill(&mut self) -> Result<(), PtyError> {
        // Best-effort kill; child may have already exited
        let _ = self.0.kill();
        Ok(())
    }

    fn is_alive(&mut self) -> Result<bool, PtyError> {
        match self.0.try_wait() {
            Ok(Some(_)) => Ok(false), // exited
            Ok(None) => Ok(true),     // still running
            Err(_) => Ok(false),      // assume dead on error
        }
    }
}

struct RealPtyResizer {
    master: std::sync::Mutex<Box<dyn portable_pty::MasterPty + Send>>,
}

impl PtyResizer for RealPtyResizer {
    fn resize(&self, rows: u16, cols: u16) -> Result<(), PtyError> {
        self.master
            .lock()
            .expect("master pty mutex poisoned")
            .resize(portable_pty::PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::ResizeFailed(e.to_string()))
    }
}

pub struct RealPtyBackend;

impl RealPtyBackend {
    pub fn new() -> Self {
        Self
    }

    pub(crate) fn detect_shell(config: &PtyConfig) -> String {
        if let Some(ref shell) = config.shell {
            return shell.clone();
        }

        #[cfg(unix)]
        {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        }

        #[cfg(windows)]
        {
            for candidate in &["pwsh", "powershell"] {
                if std::process::Command::new(candidate)
                    .arg("--version")
                    .output()
                    .is_ok()
                {
                    return candidate.to_string();
                }
            }
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
        }
    }
}

impl Default for RealPtyBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyBackend for RealPtyBackend {
    fn spawn(&self, config: &PtyConfig) -> Result<SpawnedPty, PtyError> {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize as PortablePtySize};

        let shell = Self::detect_shell(config);
        let rows = config.rows.unwrap_or(24);
        let cols = config.cols.unwrap_or(80);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PortablePtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::SpawnFailed(std::io::Error::other(e.to_string())))?;

        let mut cmd = CommandBuilder::new(&shell);
        cmd.env("TERM", "xterm-256color");

        if let Some(ref env) = config.env {
            for (key, value) in env {
                cmd.env(key, value);
            }
        }

        if let Some(ref cwd) = config.cwd {
            cmd.cwd(cwd);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed(std::io::Error::other(e.to_string())))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::SpawnFailed(std::io::Error::other(e.to_string())))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::SpawnFailed(std::io::Error::other(e.to_string())))?;

        drop(pair.slave);

        Ok(SpawnedPty {
            writer,
            reader,
            child: Box::new(RealChildController(child)),
            resizer: Box::new(RealPtyResizer {
                master: std::sync::Mutex::new(pair.master),
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shell_unix() {
        let config = PtyConfig {
            shell: None,
            cwd: None,
            env: None,
            rows: None,
            cols: None,
        };
        let shell = RealPtyBackend::detect_shell(&config);
        assert!(!shell.is_empty());
        #[cfg(unix)]
        {
            let expected = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
            assert_eq!(shell, expected);
        }
    }

    #[test]
    fn explicit_shell_overrides_detection() {
        let config = PtyConfig {
            shell: Some("/usr/bin/zsh".to_string()),
            cwd: None,
            env: None,
            rows: None,
            cols: None,
        };
        let shell = RealPtyBackend::detect_shell(&config);
        assert_eq!(shell, "/usr/bin/zsh");
    }
}
