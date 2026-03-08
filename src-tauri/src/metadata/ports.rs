use obelisk_protocol::PortInfo;

/// Parse Linux /proc/net/tcp format, returning only listening sockets.
///
/// Each data line has the format:
///   sl  local_address rem_address  st ...
/// where local_address is `HEX_IP:HEX_PORT` and st `0A` means LISTEN.
pub fn parse_proc_net_tcp(content: &str) -> Vec<PortInfo> {
    content
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            // Skip header or empty lines — data lines start with a digit
            if line.is_empty() || !line.as_bytes().first().is_some_and(u8::is_ascii_digit) {
                return None;
            }
            let fields: Vec<&str> = line.split_whitespace().collect();
            // Need at least: sl(0) local_addr(1) rem_addr(2) state(3)
            if fields.len() < 4 {
                return None;
            }
            // State 0A = LISTEN
            if fields[3] != "0A" {
                return None;
            }
            // local_address is IP:PORT in hex
            let port_hex = fields[1].split(':').nth(1)?;
            let port = u16::from_str_radix(port_hex, 16).ok()?;
            Some(PortInfo {
                port,
                protocol: "tcp".to_string(),
                pid: None,
                process_name: None,
            })
        })
        .collect()
}

/// Parse macOS `lsof -iTCP -sTCP:LISTEN -nP` output.
///
/// Expected format:
///   COMMAND  PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
///   node   12345 user 25u IPv4 123456 0t0 TCP *:3000 (LISTEN)
pub fn parse_lsof_output(output: &str) -> Vec<PortInfo> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if !line.ends_with("(LISTEN)") {
                return None;
            }
            let fields: Vec<&str> = line.split_whitespace().collect();
            // Minimum fields: COMMAND(0) PID(1) ... NAME(n-1) (LISTEN)(n)
            if fields.len() < 10 {
                return None;
            }
            let command = fields[0];
            let pid: u32 = fields[1].parse().ok()?;
            // NAME field is second-to-last (last is "(LISTEN)")
            let name_field = fields[fields.len() - 2];
            // name_field is like "*:3000" or "127.0.0.1:8080"
            let port: u16 = name_field.rsplit(':').next()?.parse().ok()?;
            Some(PortInfo {
                port,
                protocol: "tcp".to_string(),
                pid: Some(pid),
                process_name: Some(command.to_string()),
            })
        })
        .collect()
}

/// Parse Windows `netstat -ano` output.
///
/// Expected format:
///   Proto  Local Address  Foreign Address  State  PID
///   TCP    0.0.0.0:80     0.0.0.0:0        LISTENING  1234
pub fn parse_netstat_output(output: &str) -> Vec<PortInfo> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let fields: Vec<&str> = line.split_whitespace().collect();
            // Need: Proto(0) LocalAddr(1) ForeignAddr(2) State(3) PID(4)
            if fields.len() < 5 {
                return None;
            }
            if !fields[3].eq_ignore_ascii_case("LISTENING") {
                return None;
            }
            let proto = fields[0].to_ascii_lowercase();
            if proto != "tcp" && proto != "udp" {
                return None;
            }
            let port: u16 = fields[1].rsplit(':').next()?.parse().ok()?;
            let pid: u32 = fields[4].parse().ok()?;
            Some(PortInfo {
                port,
                protocol: proto,
                pid: Some(pid),
                process_name: None,
            })
        })
        .collect()
}

pub struct PortScanner;

impl PortScanner {
    /// Get listening ports using platform-appropriate method.
    pub fn scan() -> Vec<PortInfo> {
        #[cfg(target_os = "linux")]
        {
            let content = std::fs::read_to_string("/proc/net/tcp").unwrap_or_default();
            parse_proc_net_tcp(&content)
        }
        #[cfg(target_os = "macos")]
        {
            let output = std::process::Command::new("lsof")
                .args(["-iTCP", "-sTCP:LISTEN", "-nP"])
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .unwrap_or_default();
            parse_lsof_output(&output)
        }
        #[cfg(target_os = "windows")]
        {
            let output = std::process::Command::new("netstat")
                .args(["-ano"])
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .unwrap_or_default();
            parse_netstat_output(&output)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_proc_net_tcp_basic() {
        let input = "\
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345
   1: 0100007F:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12346";

        let result = parse_proc_net_tcp(input);
        assert_eq!(result.len(), 2);

        assert_eq!(result[0].port, 8080); // 0x1F90
        assert_eq!(result[0].protocol, "tcp");
        assert!(result[0].pid.is_none());

        assert_eq!(result[1].port, 80); // 0x0050
        assert_eq!(result[1].protocol, "tcp");
    }

    #[test]
    fn parse_proc_net_tcp_ignores_non_listen() {
        let input = "\
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345
   1: 0100007F:0050 0100007F:1F90 01 00000000:00000000 00:00000000 00000000     0        0 12347";

        let result = parse_proc_net_tcp(input);
        // Only the LISTEN (0A) entry should be returned, not ESTABLISHED (01)
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].port, 8080);
    }

    #[test]
    fn parse_lsof_output_basic() {
        let input = "\
COMMAND     PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node      12345 user  25u  IPv4 123456      0t0  TCP *:3000 (LISTEN)
python    12346 user  3u   IPv4 123457      0t0  TCP 127.0.0.1:8080 (LISTEN)";

        let result = parse_lsof_output(input);
        assert_eq!(result.len(), 2);

        assert_eq!(result[0].port, 3000);
        assert_eq!(result[0].pid, Some(12345));
        assert_eq!(result[0].process_name, Some("node".to_string()));
        assert_eq!(result[0].protocol, "tcp");

        assert_eq!(result[1].port, 8080);
        assert_eq!(result[1].pid, Some(12346));
        assert_eq!(result[1].process_name, Some("python".to_string()));
    }

    #[test]
    fn parse_lsof_output_ignores_non_listen() {
        let input = "\
COMMAND     PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node      12345 user  25u  IPv4 123456      0t0  TCP *:3000 (LISTEN)
curl      12347 user  5u   IPv4 123458      0t0  TCP 192.168.1.1:54321->93.184.216.34:80 (ESTABLISHED)";

        let result = parse_lsof_output(input);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].port, 3000);
    }

    #[test]
    fn parse_netstat_output_basic() {
        let input = "\
  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       1234
  TCP    0.0.0.0:443            0.0.0.0:0              LISTENING       5678";

        let result = parse_netstat_output(input);
        assert_eq!(result.len(), 2);

        assert_eq!(result[0].port, 80);
        assert_eq!(result[0].pid, Some(1234));
        assert_eq!(result[0].protocol, "tcp");

        assert_eq!(result[1].port, 443);
        assert_eq!(result[1].pid, Some(5678));
    }

    #[test]
    fn parse_netstat_output_ignores_non_listening() {
        let input = "\
  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       1234
  TCP    192.168.1.1:54321      93.184.216.34:80       ESTABLISHED     9999";

        let result = parse_netstat_output(input);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].port, 80);
    }

    #[test]
    fn empty_input_returns_empty_vec() {
        assert!(parse_proc_net_tcp("").is_empty());
        assert!(parse_lsof_output("").is_empty());
        assert!(parse_netstat_output("").is_empty());
    }

    #[test]
    fn parse_malformed_input_no_panic() {
        let garbage = "this is not valid input\nrandom garbage\n!@#$%^&*()";
        // Should not panic, just return empty or partial results
        let _ = parse_proc_net_tcp(garbage);
        let _ = parse_lsof_output(garbage);
        let _ = parse_netstat_output(garbage);
    }
}
