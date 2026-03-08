#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Try deserializing random bytes as SessionState.
    // This ensures the deserialization path never panics on malformed input.
    let _ = serde_json::from_slice::<obelisk_lib::persistence::session::SessionState>(data);
});
