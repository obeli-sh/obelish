#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Exercise the IPC framing protocol with arbitrary bytes.
    // The framing layer reads a 4-byte big-endian length prefix followed by JSON.
    // We want to ensure it never panics on malformed input.
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    rt.block_on(async {
        // Try parsing as a request (server-side read path)
        let mut reader = &data[..];
        let _ = obelisk_protocol::framing::read_message(&mut reader).await;

        // Try parsing as a response (client-side read path)
        let mut reader = &data[..];
        let _ = obelisk_protocol::framing::read_response(&mut reader).await;
    });
});
