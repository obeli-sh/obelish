#![no_main]

use libfuzzer_sys::fuzz_target;
use obelisk_lib::metadata::ports::{parse_lsof_output, parse_netstat_output, parse_proc_net_tcp};

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        let _ = parse_proc_net_tcp(s);
        let _ = parse_lsof_output(s);
        let _ = parse_netstat_output(s);
    }
});
