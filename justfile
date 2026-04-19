# Obelisk development commands

# Start the Tauri dev server
dev:
    bun tauri dev

# Run all tests
test:
    cargo test --workspace
    bun test

# Run browser E2E validation tests
test-e2e:
    bun run test:e2e

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

# Run Rust mutation testing on high-value modules (requires cargo-mutants)
mutants:
    cargo mutants -p obelisk -- --test-threads=1 -F src-tauri/src/workspace/ -F src-tauri/src/commands.rs

# Run TypeScript mutation testing on high-value modules
mutate-ts:
    bun run mutate

# Run visual regression snapshot tests
test-visual:
    bun run test:e2e -- --grep "visual regression"

# Update visual regression baseline screenshots
test-visual-update:
    bun run test:e2e -- --grep "visual regression" --update-snapshots

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

# Run visual regression tests
test-visual:
    bun run test:e2e -- --grep "Visual Regression"

# Update visual regression snapshots
test-visual-update:
    bun run test:e2e -- --grep "Visual Regression" --update-snapshots

# Run Rust mutation testing (cargo-mutants)
mutants:
    cd src-tauri && cargo mutants

# Run TypeScript mutation testing (Stryker)
mutate-ts:
    bun run mutate

# Print binary and bundle sizes
check-sizes:
    @echo "=== CLI binary ==="
    @ls -lh target/release/obelisk 2>/dev/null || echo "CLI not built yet (run: just release-cli)"
    @echo ""
    @echo "=== Tauri bundles ==="
    @find target/release/bundle -type f \( -name "*.deb" -o -name "*.AppImage" -o -name "*.dmg" -o -name "*.msi" -o -name "*.exe" -o -name "*.app" \) -exec ls -lh {} \; 2>/dev/null || echo "Bundles not built yet (run: just release)"
