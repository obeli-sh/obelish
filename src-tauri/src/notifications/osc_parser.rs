#[derive(Debug, Clone, PartialEq)]
pub struct OscNotification {
    pub osc_type: u32,
    pub title: String,
    pub body: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
enum State {
    Normal,
    Esc,
    OscCode,
    OscPayload,
    EscInPayload,
}

const MAX_PAYLOAD_SIZE: usize = 64 * 1024; // 64KB

pub struct OscParser {
    state: State,
    osc_code: String,
    payload: String,
}

impl Default for OscParser {
    fn default() -> Self {
        Self::new()
    }
}

impl OscParser {
    pub fn new() -> Self {
        Self {
            state: State::Normal,
            osc_code: String::new(),
            payload: String::new(),
        }
    }

    pub fn feed(&mut self, bytes: &[u8]) -> (Vec<u8>, Vec<OscNotification>) {
        let mut forwarded = Vec::with_capacity(bytes.len());
        let mut notifications = Vec::new();

        for &byte in bytes {
            forwarded.push(byte);

            match self.state {
                State::Normal => {
                    if byte == 0x1b {
                        self.state = State::Esc;
                    }
                }
                State::Esc => {
                    if byte == b']' {
                        self.state = State::OscCode;
                        self.osc_code.clear();
                        self.payload.clear();
                    } else {
                        self.state = State::Normal;
                    }
                }
                State::OscCode => {
                    if byte == b';' {
                        self.state = State::OscPayload;
                    } else if byte.is_ascii_digit() {
                        self.osc_code.push(byte as char);
                    } else {
                        // Invalid OSC code character, abort
                        self.state = State::Normal;
                    }
                }
                State::OscPayload => {
                    if byte == 0x07 {
                        // BEL terminates
                        self.emit_notification(&mut notifications);
                        self.state = State::Normal;
                    } else if byte == 0x1b {
                        self.state = State::EscInPayload;
                    } else if self.payload.len() >= MAX_PAYLOAD_SIZE {
                        // Payload too large, abort OSC sequence
                        self.state = State::Normal;
                    } else {
                        self.payload.push(byte as char);
                    }
                }
                State::EscInPayload => {
                    if byte == b'\\' {
                        // ST (ESC \) terminates
                        self.emit_notification(&mut notifications);
                        self.state = State::Normal;
                    } else {
                        // Not ST, treat ESC as part of payload and re-process byte
                        self.payload.push('\x1b');
                        if byte == 0x07 {
                            self.emit_notification(&mut notifications);
                            self.state = State::Normal;
                        } else {
                            self.payload.push(byte as char);
                            self.state = State::OscPayload;
                        }
                    }
                }
            }
        }

        (forwarded, notifications)
    }

    fn emit_notification(&mut self, notifications: &mut Vec<OscNotification>) {
        let code: u32 = match self.osc_code.parse() {
            Ok(c) => c,
            Err(_) => return,
        };

        match code {
            9 => {
                notifications.push(OscNotification {
                    osc_type: 9,
                    title: self.payload.clone(),
                    body: None,
                });
            }
            99 => {
                // Format: optional "i=ID;" prefix followed by body
                let payload = &self.payload;
                let body = if let Some(rest) = payload.strip_prefix("i=") {
                    // Skip past the id value and semicolon
                    match rest.find(';') {
                        Some(pos) => &rest[pos + 1..],
                        None => rest,
                    }
                } else {
                    payload
                };
                notifications.push(OscNotification {
                    osc_type: 99,
                    title: body.to_string(),
                    body: None,
                });
            }
            777 => {
                // Format: notify;title;body or notify;title
                let payload = &self.payload;
                if let Some(rest) = payload.strip_prefix("notify;") {
                    let (title, body) = match rest.find(';') {
                        Some(pos) => (&rest[..pos], Some(rest[pos + 1..].to_string())),
                        None => (rest, None),
                    };
                    notifications.push(OscNotification {
                        osc_type: 777,
                        title: title.to_string(),
                        body,
                    });
                }
            }
            _ => {
                // Unknown OSC code, ignore
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input() {
        let mut parser = OscParser::new();
        let (forwarded, notifications) = parser.feed(b"");
        assert_eq!(forwarded.len(), 0);
        assert!(notifications.is_empty());
    }

    #[test]
    fn normal_text_forwarded_unchanged() {
        let mut parser = OscParser::new();
        let input = b"Hello, world!";
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(&forwarded, input);
        assert!(notifications.is_empty());
    }

    #[test]
    fn osc9_bel_terminator() {
        let mut parser = OscParser::new();
        // ESC ] 9 ; message BEL
        let input = b"\x1b]9;Hello from terminal\x07";
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].osc_type, 9);
        assert_eq!(notifications[0].title, "Hello from terminal");
        assert_eq!(notifications[0].body, None);
    }

    #[test]
    fn osc9_st_terminator() {
        let mut parser = OscParser::new();
        // ESC ] 9 ; message ESC \
        let input = b"\x1b]9;Hello from terminal\x1b\\";
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].osc_type, 9);
        assert_eq!(notifications[0].title, "Hello from terminal");
        assert_eq!(notifications[0].body, None);
    }

    #[test]
    fn osc9_empty_body() {
        let mut parser = OscParser::new();
        let input = b"\x1b]9;\x07";
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].osc_type, 9);
        assert_eq!(notifications[0].title, "");
        assert_eq!(notifications[0].body, None);
    }

    #[test]
    fn osc99_simple() {
        let mut parser = OscParser::new();
        // OSC 99: ESC]99;i=123;Hello kitty BEL
        let input = b"\x1b]99;i=123;Hello kitty\x07";
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].osc_type, 99);
        assert_eq!(notifications[0].title, "Hello kitty");
        assert_eq!(notifications[0].body, None);
    }

    #[test]
    fn osc99_without_id() {
        let mut parser = OscParser::new();
        // OSC 99 without id parameter
        let input = b"\x1b]99;Just a message\x07";
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].osc_type, 99);
        assert_eq!(notifications[0].title, "Just a message");
        assert_eq!(notifications[0].body, None);
    }

    #[test]
    fn osc777_title_and_body() {
        let mut parser = OscParser::new();
        // OSC 777: ESC]777;notify;Title;Body text BEL
        let input = b"\x1b]777;notify;My Title;My Body\x07";
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].osc_type, 777);
        assert_eq!(notifications[0].title, "My Title");
        assert_eq!(notifications[0].body, Some("My Body".to_string()));
    }

    #[test]
    fn osc777_title_only() {
        let mut parser = OscParser::new();
        let input = b"\x1b]777;notify;My Title\x07";
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].osc_type, 777);
        assert_eq!(notifications[0].title, "My Title");
        assert_eq!(notifications[0].body, None);
    }

    #[test]
    fn unknown_osc_code() {
        let mut parser = OscParser::new();
        // OSC 52 (clipboard) - not a notification code
        let input = b"\x1b]52;c;SGVsbG8=\x07";
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert!(notifications.is_empty());
    }

    #[test]
    fn partial_sequence_across_reads() {
        let full_input = b"\x1b]9;Hello\x07";

        // Split at various points and verify same result
        for split_point in 1..full_input.len() {
            let mut parser = OscParser::new();
            let (fwd1, notifs1) = parser.feed(&full_input[..split_point]);
            let (fwd2, notifs2) = parser.feed(&full_input[split_point..]);

            let total_forwarded = fwd1.len() + fwd2.len();
            assert_eq!(total_forwarded, full_input.len(), "split at {split_point}");

            let mut all_notifs = notifs1;
            all_notifs.extend(notifs2);
            assert_eq!(all_notifs.len(), 1, "split at {split_point}");
            assert_eq!(all_notifs[0].osc_type, 9);
            assert_eq!(all_notifs[0].title, "Hello");
        }
    }

    #[test]
    fn multiple_notifications_single_read() {
        let mut parser = OscParser::new();
        let input = b"\x1b]9;First\x07\x1b]9;Second\x07";
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(notifications.len(), 2);
        assert_eq!(notifications[0].title, "First");
        assert_eq!(notifications[1].title, "Second");
    }

    #[test]
    fn interleaved_text_and_osc() {
        let mut parser = OscParser::new();
        let input = b"hello\x1b]9;msg\x07world";
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].title, "msg");
        // All bytes forwarded including text and OSC
        assert_eq!(&forwarded, input.as_slice());
    }

    #[test]
    fn esc_not_followed_by_bracket() {
        let mut parser = OscParser::new();
        // ANSI color escape: ESC [ 3 2 m
        let input = b"\x1b[32m";
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(&forwarded, input.as_slice());
        assert!(notifications.is_empty());
    }

    #[test]
    fn very_long_payload() {
        let mut parser = OscParser::new();
        let payload = "x".repeat(10 * 1024); // 10KB
        let input_str = format!("\x1b]9;{}\x07", payload);
        let input = input_str.as_bytes();
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].title, payload);
    }

    #[test]
    fn all_bytes_always_forwarded() {
        // Verify forwarded.len() == input.len() for all test inputs
        let test_inputs: Vec<&[u8]> = vec![
            b"",
            b"Hello, world!",
            b"\x1b]9;Hello\x07",
            b"\x1b]9;Hello\x1b\\",
            b"\x1b]9;\x07",
            b"\x1b]99;i=123;Hello\x07",
            b"\x1b]777;notify;Title;Body\x07",
            b"\x1b]52;c;SGVsbG8=\x07",
            b"\x1b]9;First\x07\x1b]9;Second\x07",
            b"hello\x1b]9;msg\x07world",
            b"\x1b[32m",
        ];

        for input in test_inputs {
            let mut parser = OscParser::new();
            let (forwarded, _) = parser.feed(input);
            assert_eq!(
                forwarded.len(),
                input.len(),
                "forwarded len mismatch for input {:?}",
                String::from_utf8_lossy(input)
            );
        }
    }

    #[test]
    fn rapid_sequential_notifications() {
        let mut parser = OscParser::new();
        let single = b"\x1b]9;msg\x07";
        let input: Vec<u8> = single.iter().copied().cycle().take(single.len() * 100).collect();
        let (forwarded, notifications) = parser.feed(&input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(notifications.len(), 100);
    }

    #[test]
    fn binary_data_in_normal_mode() {
        let mut parser = OscParser::new();
        let input: Vec<u8> = (0..=255).collect();
        let (forwarded, _) = parser.feed(&input);
        assert_eq!(forwarded.len(), input.len());
    }

    #[test]
    fn payload_exceeding_max_size_aborts_sequence() {
        let mut parser = OscParser::new();
        // Payload larger than MAX_PAYLOAD_SIZE (64KB)
        let payload = "x".repeat(MAX_PAYLOAD_SIZE + 100);
        let input_str = format!("\x1b]9;{}\x07", payload);
        let input = input_str.as_bytes();
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        // Sequence should be aborted, no notification extracted
        assert!(notifications.is_empty());
    }

    #[test]
    fn payload_at_max_size_still_works() {
        let mut parser = OscParser::new();
        // Payload exactly at MAX_PAYLOAD_SIZE - 1 (last byte that fits)
        let payload = "x".repeat(MAX_PAYLOAD_SIZE - 1);
        let input_str = format!("\x1b]9;{}\x07", payload);
        let input = input_str.as_bytes();
        let (forwarded, notifications) = parser.feed(input);
        assert_eq!(forwarded.len(), input.len());
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].title.len(), MAX_PAYLOAD_SIZE - 1);
    }

    #[test]
    fn reset_after_complete_sequence() {
        let mut parser = OscParser::new();
        // First sequence
        let (fwd1, notifs1) = parser.feed(b"\x1b]9;First\x07");
        assert_eq!(notifs1.len(), 1);
        assert_eq!(fwd1.len(), b"\x1b]9;First\x07".len());

        // Normal text after sequence
        let (fwd2, notifs2) = parser.feed(b"normal text");
        assert_eq!(&fwd2, b"normal text");
        assert!(notifs2.is_empty());

        // Second sequence
        let (fwd3, notifs3) = parser.feed(b"\x1b]9;Second\x07");
        assert_eq!(notifs3.len(), 1);
        assert_eq!(notifs3[0].title, "Second");
        assert_eq!(fwd3.len(), b"\x1b]9;Second\x07".len());
    }
}
