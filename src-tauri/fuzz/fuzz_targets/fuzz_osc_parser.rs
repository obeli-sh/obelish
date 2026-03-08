#![no_main]

use libfuzzer_sys::fuzz_target;
use obelisk_lib::notifications::osc_parser::OscParser;

fuzz_target!(|data: &[u8]| {
    let mut parser = OscParser::new();
    let (_passthrough, _notifications, _error) = parser.feed(data);

    // Feed data in small chunks to exercise stateful parsing across boundaries.
    let mut parser2 = OscParser::new();
    for chunk in data.chunks(3) {
        let _ = parser2.feed(chunk);
    }
});
