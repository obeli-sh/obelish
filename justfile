# Obelisk development commands

# Start the Tauri dev server
dev:
    bun tauri dev

# Run all tests
test:
    cargo test --workspace
    bun test

# Run lints
lint:
    cargo fmt --check
    cargo clippy --workspace -- -D warnings
    bun run lint
    bun run typecheck

# Run test coverage
coverage:
    cargo test --workspace
    bun run test:coverage

# Run benchmarks
bench:
    cargo bench -p obelisk

# Build Tauri app for production
release:
    bun tauri build

alias build := release

# Build release CLI binary
release-cli:
    cargo build --release -p obelisk-cli

# Build both Tauri app and CLI
release-all: release release-cli

# Generate icons from source image
icons source:
    bun tauri icon {{source}}

# Print binary and bundle sizes
check-sizes:
    @echo "=== CLI binary ==="
    @ls -lh target/release/obelisk 2>/dev/null || echo "CLI not built yet (run: just release-cli)"
    @echo ""
    @echo "=== Tauri bundles ==="
    @find target/release/bundle -type f \( -name "*.deb" -o -name "*.AppImage" -o -name "*.dmg" -o -name "*.msi" -o -name "*.exe" -o -name "*.app" \) -exec ls -lh {} \; 2>/dev/null || echo "Bundles not built yet (run: just release)"
