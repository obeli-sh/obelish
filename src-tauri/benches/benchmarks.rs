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

criterion_group!(
    benches,
    bench_base64_encode,
    bench_base64_decode,
    bench_event_serialization,
    bench_osc_parser_placeholder,
);
criterion_main!(benches);
