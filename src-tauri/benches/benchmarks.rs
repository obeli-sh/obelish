use base64::Engine;
use criterion::{criterion_group, criterion_main, Criterion, Throughput};

fn bench_base64_encode(c: &mut Criterion) {
    let data = vec![0u8; 16 * 1024]; // 16KB chunk (typical PTY read)

    let mut group = c.benchmark_group("pty-encode");
    group.throughput(Throughput::Bytes(data.len() as u64));

    group.bench_function("base64-encode-16kb", |b| {
        b.iter(|| base64::engine::general_purpose::STANDARD.encode(std::hint::black_box(&data)));
    });

    group.finish();
}

fn bench_base64_decode(c: &mut Criterion) {
    let data = vec![0u8; 16 * 1024];
    let encoded = base64::engine::general_purpose::STANDARD.encode(&data);

    let mut group = c.benchmark_group("pty-decode");
    group.throughput(Throughput::Bytes(data.len() as u64));

    group.bench_function("base64-decode-16kb", |b| {
        b.iter(|| {
            base64::engine::general_purpose::STANDARD
                .decode(std::hint::black_box(&encoded))
                .unwrap()
        });
    });

    group.finish();
}

fn bench_event_serialization(c: &mut Criterion) {
    let data = vec![0u8; 16 * 1024];
    let encoded = base64::engine::general_purpose::STANDARD.encode(&data);
    let payload = serde_json::json!({ "data": encoded });

    let mut group = c.benchmark_group("event-serialization");

    group.bench_function("serialize-pty-data-16kb", |b| {
        b.iter(|| serde_json::to_string(std::hint::black_box(&payload)).unwrap());
    });

    group.bench_function("deserialize-pty-data-16kb", |b| {
        let json_str = serde_json::to_string(&payload).unwrap();
        b.iter(|| {
            serde_json::from_str::<serde_json::Value>(std::hint::black_box(&json_str)).unwrap()
        });
    });

    group.finish();
}

fn bench_osc_parser_placeholder(c: &mut Criterion) {
    // Placeholder for Phase 4 OSC parser benchmarks
    let data = vec![b'a'; 10 * 1024 * 1024]; // 10MB of plain data

    let mut group = c.benchmark_group("osc-parser-placeholder");
    group.throughput(Throughput::Bytes(data.len() as u64));

    group.bench_function("passthrough-10mb", |b| {
        b.iter(|| {
            // Phase 4: will parse OSC sequences from this data
            // For now, just measure the baseline of iterating through bytes
            let mut count = 0u64;
            for &byte in std::hint::black_box(&data) {
                if byte == 0x1b {
                    count += 1;
                }
            }
            count
        });
    });

    group.finish();
}

fn bench_workspace_split_pane(c: &mut Criterion) {
    use obelisk_lib::workspace::WorkspaceState;
    use obelisk_protocol::SplitDirection;

    let mut group = c.benchmark_group("workspace");

    group.bench_function("split_pane_100_times", |b| {
        b.iter(|| {
            let mut state = WorkspaceState::new();
            state.create_workspace(
                "Bench".to_string(),
                "pane-0".to_string(),
                "pty-0".to_string(),
                String::new(),
                String::new(),
                None,
                false,
            );
            for i in 1..=100 {
                // Always split the first pane so layout gets deeper
                state
                    .split_pane(
                        "pane-0",
                        if i % 2 == 0 {
                            SplitDirection::Horizontal
                        } else {
                            SplitDirection::Vertical
                        },
                        format!("pane-{i}"),
                        format!("pty-{i}"),
                    )
                    .unwrap();
            }
            std::hint::black_box(&state);
        });
    });

    group.finish();
}

fn bench_workspace_close_pane(c: &mut Criterion) {
    use obelisk_lib::workspace::WorkspaceState;
    use obelisk_protocol::SplitDirection;

    let mut group = c.benchmark_group("workspace");

    group.bench_function("close_panes_from_deep_layout", |b| {
        b.iter_batched(
            || {
                // Setup: create a deeply nested layout with 50 panes
                let mut state = WorkspaceState::new();
                state.create_workspace(
                    "Bench".to_string(),
                    "pane-0".to_string(),
                    "pty-0".to_string(),
                    String::new(),
                    String::new(),
                    None,
                    false,
                );
                for i in 1..50 {
                    state
                        .split_pane(
                            &format!("pane-{}", i - 1),
                            SplitDirection::Horizontal,
                            format!("pane-{i}"),
                            format!("pty-{i}"),
                        )
                        .unwrap();
                }
                state
            },
            |mut state| {
                // Close panes from the deepest to shallowest
                for i in (1..50).rev() {
                    state.close_pane(&format!("pane-{i}")).unwrap();
                }
                std::hint::black_box(&state);
            },
            criterion::BatchSize::SmallInput,
        );
    });

    group.finish();
}

fn bench_osc_parser_feed(c: &mut Criterion) {
    use obelisk_lib::notifications::osc_parser::OscParser;

    // Build 1MB of mixed terminal output with OSC sequences interspersed
    let mut data = Vec::with_capacity(1024 * 1024);
    let normal_chunk =
        b"Hello, this is normal terminal output with colors \x1b[32mgreen\x1b[0m and stuff.\r\n";
    let osc_chunk = b"\x1b]9;Build complete\x07";
    let osc7_chunk = b"\x1b]7;file://localhost/home/user/project\x07";

    while data.len() < 1024 * 1024 {
        // Mix normal text with occasional OSC sequences
        for _ in 0..10 {
            data.extend_from_slice(normal_chunk);
        }
        data.extend_from_slice(osc_chunk);
        data.extend_from_slice(osc7_chunk);
    }
    data.truncate(1024 * 1024);

    let mut group = c.benchmark_group("osc-parser");
    group.throughput(Throughput::Bytes(data.len() as u64));

    group.bench_function("feed-1mb-mixed-output", |b| {
        b.iter(|| {
            let mut parser = OscParser::new();
            let result = parser.feed(std::hint::black_box(&data));
            std::hint::black_box(&result);
        });
    });

    group.finish();
}

fn bench_parse_proc_net_tcp(c: &mut Criterion) {
    use obelisk_lib::metadata::ports::parse_proc_net_tcp;

    // Build a realistic /proc/net/tcp with 100 entries
    let mut content = String::from(
        "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n",
    );
    for i in 0..100u16 {
        let port_hex = format!("{:04X}", 3000 + i);
        // Alternate between LISTEN (0A) and ESTABLISHED (01) states
        let state = if i % 3 == 0 { "01" } else { "0A" };
        content.push_str(&format!(
            "   {i}: 00000000:{port_hex} 00000000:0000 {state} 00000000:00000000 00:00000000 00000000  1000        0 {}\n",
            12345 + i as u32
        ));
    }

    let mut group = c.benchmark_group("port-parsing");

    group.bench_function("parse_proc_net_tcp_100_entries", |b| {
        b.iter(|| {
            let result = parse_proc_net_tcp(std::hint::black_box(&content));
            std::hint::black_box(&result);
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_base64_encode,
    bench_base64_decode,
    bench_event_serialization,
    bench_osc_parser_placeholder,
    bench_workspace_split_pane,
    bench_workspace_close_pane,
    bench_osc_parser_feed,
    bench_parse_proc_net_tcp,
);
criterion_main!(benches);
