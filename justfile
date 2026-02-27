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

# Build for production
build:
    bun tauri build
