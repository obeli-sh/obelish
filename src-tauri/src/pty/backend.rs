use crate::error::PtyError;
use crate::pty::types::PtyConfig;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ShellInfo {
    pub path: String,
    pub name: String,
}

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

    pub fn enumerate_shells() -> Vec<ShellInfo> {
        let mut shells = Vec::new();
        let mut seen_paths = std::collections::HashSet::new();

        #[cfg(unix)]
        {
            // Parse /etc/shells
            if let Ok(contents) = std::fs::read_to_string("/etc/shells") {
                for line in contents.lines() {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with('#') {
                        continue;
                    }
                    if std::path::Path::new(line).exists() && seen_paths.insert(line.to_string()) {
                        let name = shell_name_from_path(line);
                        shells.push(ShellInfo {
                            path: line.to_string(),
                            name,
                        });
                    }
                }
            }

            // Fallback: probe known paths if /etc/shells yielded nothing
            if shells.is_empty() {
                let known = [
                    "/bin/bash",
                    "/bin/zsh",
                    "/bin/fish",
                    "/usr/bin/bash",
                    "/usr/bin/zsh",
                    "/usr/bin/fish",
                    "/bin/sh",
                ];
                for path in &known {
                    if std::path::Path::new(path).exists() && seen_paths.insert(path.to_string()) {
                        let name = shell_name_from_path(path);
                        shells.push(ShellInfo {
                            path: path.to_string(),
                            name,
                        });
                    }
                }
            }

            // WSL: also enumerate Windows-side shells accessible via .exe interop
            if is_wsl() {
                // PowerShell 7+ (pwsh.exe)
                if std::process::Command::new("pwsh.exe")
                    .arg("--version")
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
                    && seen_paths.insert("pwsh.exe".to_string())
                {
                    shells.push(ShellInfo {
                        path: "pwsh.exe".to_string(),
                        name: "PowerShell".to_string(),
                    });
                }

                // Windows PowerShell (powershell.exe)
                if std::process::Command::new("powershell.exe")
                    .arg("-Command")
                    .arg("echo ok")
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
                    && seen_paths.insert("powershell.exe".to_string())
                {
                    shells.push(ShellInfo {
                        path: "powershell.exe".to_string(),
                        name: "Windows PowerShell".to_string(),
                    });
                }

                // Command Prompt (cmd.exe)
                if std::process::Command::new("cmd.exe")
                    .arg("/c")
                    .arg("echo ok")
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
                    && seen_paths.insert("cmd.exe".to_string())
                {
                    shells.push(ShellInfo {
                        path: "cmd.exe".to_string(),
                        name: "Command Prompt".to_string(),
                    });
                }

                // Other WSL distributions
                if let Ok(output) = std::process::Command::new("wsl.exe")
                    .args(["--list", "--quiet"])
                    .output()
                {
                    if output.status.success() {
                        // wsl.exe outputs UTF-16LE even when called from WSL
                        let stdout = decode_utf16le(&output.stdout);
                        for line in stdout.lines() {
                            let distro = line.trim().trim_start_matches('\u{feff}');
                            if !distro.is_empty() {
                                let path = format!("wsl.exe -d {distro}");
                                if seen_paths.insert(path.clone()) {
                                    shells.push(ShellInfo {
                                        path,
                                        name: format!("WSL: {distro}"),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        #[cfg(windows)]
        {
            // PowerShell 7+
            if which_exists("pwsh") {
                shells.push(ShellInfo {
                    path: "pwsh".to_string(),
                    name: "PowerShell".to_string(),
                });
            }

            // Windows PowerShell
            if which_exists("powershell") {
                shells.push(ShellInfo {
                    path: "powershell".to_string(),
                    name: "Windows PowerShell".to_string(),
                });
            }

            // Command Prompt
            let cmd_path = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
            shells.push(ShellInfo {
                path: cmd_path,
                name: "Command Prompt".to_string(),
            });

            // Git Bash — quote paths that contain spaces so parse_shell_command
            // can split them correctly.
            let git_bash_paths = [
                r"C:\Program Files\Git\bin\bash.exe",
                r"C:\Program Files (x86)\Git\bin\bash.exe",
            ];
            for path in &git_bash_paths {
                if std::path::Path::new(path).exists() && seen_paths.insert(path.to_string()) {
                    shells.push(ShellInfo {
                        path: format!("\"{}\"", path),
                        name: "Git Bash".to_string(),
                    });
                }
            }

            // WSL distributions
            if let Ok(output) = std::process::Command::new("wsl")
                .args(["--list", "--quiet"])
                .output()
            {
                if output.status.success() {
                    let stdout = decode_utf16le(&output.stdout);
                    for line in stdout.lines() {
                        let distro = line.trim().trim_start_matches('\u{feff}');
                        if !distro.is_empty() {
                            let path = format!("wsl -d {distro}");
                            if seen_paths.insert(path.clone()) {
                                shells.push(ShellInfo {
                                    path,
                                    name: format!("WSL: {distro}"),
                                });
                            }
                        }
                    }
                }
            }
        }

        shells
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

/// Detect whether we're running inside WSL by checking /proc/version.
#[cfg(any(unix, test))]
fn is_wsl() -> bool {
    #[cfg(unix)]
    {
        std::fs::read_to_string("/proc/version")
            .map(|v| v.to_lowercase().contains("microsoft"))
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        false
    }
}

/// Decode a byte slice as UTF-16LE into a String.
fn decode_utf16le(bytes: &[u8]) -> String {
    let u16s: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16_lossy(&u16s)
}

#[cfg(any(unix, test))]
fn shell_name_from_path(path: &str) -> String {
    let filename = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path);
    let base = filename.strip_suffix(".exe").unwrap_or(filename);
    let mut chars = base.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().to_string() + chars.as_str(),
        None => base.to_string(),
    }
}

#[cfg(windows)]
fn which_exists(name: &str) -> bool {
    std::process::Command::new("where")
        .arg(name)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Parse a shell command string into (program, args).
///
/// Handles:
/// - Simple paths: `"/bin/bash"` -> `("/bin/bash", [])`
/// - Commands with args: `"wsl -d Ubuntu"` -> `("wsl", ["-d", "Ubuntu"])`
/// - Quoted paths: `"\"C:\Program Files\Git\bin\bash.exe\" --login"` -> `("C:\Program Files\Git\bin\bash.exe", ["--login"])`
fn parse_shell_command(shell: &str) -> (String, Vec<String>) {
    let trimmed = shell.trim();

    if let Some(after_quote) = trimmed.strip_prefix('"') {
        // Quoted executable: find closing quote
        if let Some(end_quote) = after_quote.find('"') {
            let prog = &after_quote[..end_quote];
            let rest = after_quote[end_quote + 1..].trim();
            let args: Vec<String> = if rest.is_empty() {
                Vec::new()
            } else {
                rest.split_whitespace().map(String::from).collect()
            };
            return (prog.to_string(), args);
        }
    }

    let mut parts = trimmed.split_whitespace();
    let prog = parts.next().unwrap_or("").to_string();
    let args: Vec<String> = parts.map(String::from).collect();
    (prog, args)
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

        let (prog, args) = parse_shell_command(&shell);
        let mut cmd = CommandBuilder::new(&prog);
        for arg in &args {
            cmd.arg(arg);
        }
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
    fn enumerate_shells_returns_non_empty_list() {
        let shells = RealPtyBackend::enumerate_shells();
        assert!(
            !shells.is_empty(),
            "enumerate_shells should return at least one shell"
        );
    }

    #[test]
    fn enumerate_shells_entries_have_non_empty_name_and_path() {
        let shells = RealPtyBackend::enumerate_shells();
        for shell in &shells {
            assert!(!shell.name.is_empty(), "shell name should not be empty");
            assert!(!shell.path.is_empty(), "shell path should not be empty");
        }
    }

    #[test]
    fn enumerate_shells_no_duplicate_paths() {
        let shells = RealPtyBackend::enumerate_shells();
        let mut seen = std::collections::HashSet::new();
        for shell in &shells {
            assert!(
                seen.insert(&shell.path),
                "duplicate shell path: {}",
                shell.path
            );
        }
    }

    #[test]
    fn shell_info_serialization_roundtrip() {
        let info = ShellInfo {
            path: "/usr/bin/zsh".to_string(),
            name: "Zsh".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        let deserialized: ShellInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(info, deserialized);
    }

    #[test]
    fn shell_name_from_path_capitalizes_first_letter() {
        assert_eq!(super::shell_name_from_path("/bin/bash"), "Bash");
        assert_eq!(super::shell_name_from_path("/usr/bin/zsh"), "Zsh");
        assert_eq!(super::shell_name_from_path("/bin/fish"), "Fish");
        assert_eq!(super::shell_name_from_path("/bin/sh"), "Sh");
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

    #[test]
    fn is_wsl_detects_correctly() {
        let result = super::is_wsl();
        if std::path::Path::new("/proc/version").exists() {
            let version = std::fs::read_to_string("/proc/version").unwrap_or_default();
            let expected = version.to_lowercase().contains("microsoft");
            assert_eq!(result, expected);
        }
    }

    #[test]
    fn decode_utf16le_basic() {
        let bytes: Vec<u8> = vec![
            0x48, 0x00, 0x65, 0x00, 0x6C, 0x00, 0x6C, 0x00, 0x6F, 0x00, 0x0D, 0x00, 0x0A, 0x00,
        ];
        let result = super::decode_utf16le(&bytes);
        assert_eq!(result, "Hello\r\n");
    }

    #[test]
    fn decode_utf16le_with_bom() {
        let bytes: Vec<u8> = vec![0xFF, 0xFE, 0x48, 0x00, 0x69, 0x00];
        let result = super::decode_utf16le(&bytes);
        assert_eq!(result, "\u{feff}Hi");
    }

    #[test]
    fn decode_utf16le_empty() {
        let result = super::decode_utf16le(&[]);
        assert_eq!(result, "");
    }

    #[test]
    fn decode_utf16le_odd_byte_count() {
        let bytes: Vec<u8> = vec![0x48, 0x00, 0x69];
        let result = super::decode_utf16le(&bytes);
        assert_eq!(result, "H");
    }

    #[cfg(unix)]
    #[test]
    fn enumerate_shells_includes_wsl_distros_if_wsl() {
        if !super::is_wsl() {
            return;
        }
        let shells = RealPtyBackend::enumerate_shells();
        let wsl_shells: Vec<_> = shells
            .iter()
            .filter(|s| s.name.starts_with("WSL:"))
            .collect();
        assert!(
            !wsl_shells.is_empty(),
            "WSL environment should enumerate at least one WSL distro, got shells: {:?}",
            shells
        );
        for s in &wsl_shells {
            assert!(
                s.path.starts_with("wsl.exe -d "),
                "WSL shell path should start with 'wsl.exe -d', got: {}",
                s.path
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn enumerate_shells_includes_windows_shells_if_wsl() {
        if !super::is_wsl() {
            return;
        }
        let shells = RealPtyBackend::enumerate_shells();
        let win_shells: Vec<_> = shells.iter().filter(|s| s.path.ends_with(".exe")).collect();
        assert!(
            !win_shells.is_empty(),
            "WSL environment should enumerate at least one Windows shell (.exe), got shells: {:?}",
            shells
        );
    }

    #[test]
    fn parse_shell_command_simple_path() {
        let (prog, args) = super::parse_shell_command("/bin/bash");
        assert_eq!(prog, "/bin/bash");
        assert!(args.is_empty());
    }

    #[test]
    fn parse_shell_command_with_args() {
        let (prog, args) = super::parse_shell_command("wsl -d Ubuntu");
        assert_eq!(prog, "wsl");
        assert_eq!(args, vec!["-d", "Ubuntu"]);
    }

    #[test]
    fn parse_shell_command_with_multiple_args() {
        let (prog, args) = super::parse_shell_command("wsl --distribution Ubuntu --user root");
        assert_eq!(prog, "wsl");
        assert_eq!(args, vec!["--distribution", "Ubuntu", "--user", "root"]);
    }

    #[test]
    fn parse_shell_command_trims_whitespace() {
        let (prog, args) = super::parse_shell_command("  wsl  -d   Ubuntu  ");
        assert_eq!(prog, "wsl");
        assert_eq!(args, vec!["-d", "Ubuntu"]);
    }

    #[test]
    fn parse_shell_command_single_word() {
        let (prog, args) = super::parse_shell_command("pwsh");
        assert_eq!(prog, "pwsh");
        assert!(args.is_empty());
    }

    #[test]
    fn parse_shell_command_windows_path_no_spaces() {
        let (prog, args) = super::parse_shell_command("C:\\Windows\\System32\\cmd.exe");
        assert_eq!(prog, "C:\\Windows\\System32\\cmd.exe");
        assert!(args.is_empty());
    }

    #[test]
    fn parse_shell_command_quoted_path_with_spaces() {
        let (prog, args) = super::parse_shell_command("\"C:\\Program Files\\Git\\bin\\bash.exe\"");
        assert_eq!(prog, "C:\\Program Files\\Git\\bin\\bash.exe");
        assert!(args.is_empty());
    }

    #[test]
    fn parse_shell_command_quoted_path_with_args() {
        let (prog, args) =
            super::parse_shell_command("\"C:\\Program Files\\Git\\bin\\bash.exe\" --login");
        assert_eq!(prog, "C:\\Program Files\\Git\\bin\\bash.exe");
        assert_eq!(args, vec!["--login"]);
    }

    #[test]
    fn parse_shell_command_wsl_exe_with_distro() {
        let (prog, args) = super::parse_shell_command("wsl.exe -d Ubuntu-24.04");
        assert_eq!(prog, "wsl.exe");
        assert_eq!(args, vec!["-d", "Ubuntu-24.04"]);
    }
}
