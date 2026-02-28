use std::fs;
use std::path::Path;

fn workspace_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap()
}

fn read_toml(path: &Path) -> toml::Value {
    let content = fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("Failed to read {}: {}", path.display(), e));
    content
        .parse::<toml::Value>()
        .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path.display(), e))
}

fn read_json(path: &Path) -> serde_json::Value {
    let content = fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("Failed to read {}: {}", path.display(), e));
    serde_json::from_str(&content)
        .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path.display(), e))
}

fn read_yaml(path: &Path) -> serde_yaml::Value {
    let content = fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("Failed to read {}: {}", path.display(), e));
    serde_yaml::from_str(&content)
        .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path.display(), e))
}

// --- Workspace release profile tests ---

#[test]
fn workspace_release_profile_has_lto() {
    let cargo = read_toml(&workspace_root().join("Cargo.toml"));
    let lto = cargo["profile"]["release"]["lto"]
        .as_str()
        .expect("profile.release.lto should be a string");
    assert_eq!(
        lto, "thin",
        "LTO should be set to 'thin' for release builds"
    );
}

#[test]
fn workspace_release_profile_has_strip() {
    let cargo = read_toml(&workspace_root().join("Cargo.toml"));
    let strip = cargo["profile"]["release"]["strip"]
        .as_bool()
        .expect("profile.release.strip should be a boolean");
    assert!(strip, "strip should be enabled for release builds");
}

#[test]
fn workspace_release_profile_has_codegen_units_1() {
    let cargo = read_toml(&workspace_root().join("Cargo.toml"));
    let units = cargo["profile"]["release"]["codegen-units"]
        .as_integer()
        .expect("profile.release.codegen-units should be an integer");
    assert_eq!(
        units, 1,
        "codegen-units should be 1 for maximum optimization"
    );
}

// --- CLI release profile tests ---

#[test]
fn cli_release_profile_optimizes_for_size() {
    let cargo = read_toml(&workspace_root().join("Cargo.toml"));
    let opt = cargo["profile"]["release"]["package"]["obelisk-cli"]["opt-level"]
        .as_str()
        .expect("profile.release.package.obelisk-cli.opt-level should be a string");
    assert_eq!(opt, "z", "CLI should optimize for size with opt-level 'z'");
}

// --- Version consistency tests ---

#[test]
fn all_crate_versions_match() {
    let root = workspace_root();

    let tauri_cargo = read_toml(&root.join("src-tauri/Cargo.toml"));
    let cli_cargo = read_toml(&root.join("cli/Cargo.toml"));
    let protocol_cargo = read_toml(&root.join("obelisk-protocol/Cargo.toml"));
    let tauri_conf = read_json(&root.join("src-tauri/tauri.conf.json"));

    let tauri_ver = tauri_cargo["package"]["version"]
        .as_str()
        .expect("src-tauri version");
    let cli_ver = cli_cargo["package"]["version"]
        .as_str()
        .expect("cli version");
    let protocol_ver = protocol_cargo["package"]["version"]
        .as_str()
        .expect("protocol version");
    let conf_ver = tauri_conf["version"]
        .as_str()
        .expect("tauri.conf.json version");

    assert_eq!(tauri_ver, cli_ver, "src-tauri and cli versions must match");
    assert_eq!(
        tauri_ver, protocol_ver,
        "src-tauri and protocol versions must match"
    );
    assert_eq!(
        tauri_ver, conf_ver,
        "src-tauri and tauri.conf.json versions must match"
    );
}

// --- Tauri bundle config tests ---

#[test]
fn tauri_conf_bundle_is_active() {
    let conf = read_json(&workspace_root().join("src-tauri/tauri.conf.json"));
    let active = conf["bundle"]["active"]
        .as_bool()
        .expect("bundle.active should be a boolean");
    assert!(active, "bundle should be active");
}

#[test]
fn tauri_conf_has_category() {
    let conf = read_json(&workspace_root().join("src-tauri/tauri.conf.json"));
    let category = conf["bundle"]["category"]
        .as_str()
        .expect("bundle.category should be set");
    assert_eq!(category, "DeveloperTool");
}

#[test]
fn tauri_conf_has_all_icon_paths() {
    let root = workspace_root();
    let conf = read_json(&root.join("src-tauri/tauri.conf.json"));
    let icons = conf["bundle"]["icon"]
        .as_array()
        .expect("bundle.icon should be an array");

    assert!(!icons.is_empty(), "icon array should not be empty");

    for icon in icons {
        let icon_path = icon.as_str().expect("icon path should be a string");
        let full_path = root.join("src-tauri").join(icon_path);
        assert!(
            full_path.exists(),
            "Icon file should exist: {}",
            full_path.display()
        );
    }
}

#[test]
fn tauri_conf_has_linux_deb_depends() {
    let conf = read_json(&workspace_root().join("src-tauri/tauri.conf.json"));
    let depends = conf["bundle"]["linux"]["deb"]["depends"]
        .as_array()
        .expect("bundle.linux.deb.depends should be an array");

    let deps: Vec<&str> = depends.iter().filter_map(|d| d.as_str()).collect();
    assert!(
        deps.contains(&"libwebkit2gtk-4.1-0"),
        "deb depends should include libwebkit2gtk-4.1-0"
    );
    assert!(
        deps.contains(&"libgtk-3-0"),
        "deb depends should include libgtk-3-0"
    );
}

#[test]
fn tauri_conf_csp_is_restrictive() {
    let conf = read_json(&workspace_root().join("src-tauri/tauri.conf.json"));
    let csp = conf["app"]["security"]["csp"]
        .as_str()
        .expect("app.security.csp should be set");

    assert!(
        csp.contains("default-src"),
        "CSP should contain default-src directive"
    );
    assert!(
        !csp.contains("unsafe-eval"),
        "CSP should not contain unsafe-eval"
    );
}

// --- CI workflow tests ---

#[test]
fn release_workflow_exists() {
    let path = workspace_root().join(".github/workflows/release.yml");
    assert!(
        path.exists(),
        "Release workflow should exist at .github/workflows/release.yml"
    );
}

#[test]
fn release_workflow_triggers_on_tags() {
    let workflow = read_yaml(&workspace_root().join(".github/workflows/release.yml"));
    let tags = workflow["on"]["push"]["tags"]
        .as_sequence()
        .expect("on.push.tags should be a sequence");
    let tag_patterns: Vec<&str> = tags.iter().filter_map(|t| t.as_str()).collect();
    assert!(
        tag_patterns.iter().any(|t| t.contains("v*")),
        "Release workflow should trigger on v* tags, got: {:?}",
        tag_patterns
    );
}

#[test]
fn release_workflow_builds_all_platforms() {
    let workflow = read_yaml(&workspace_root().join(".github/workflows/release.yml"));

    // Check build-tauri job matrix for all platforms
    let matrix = &workflow["jobs"]["build-tauri"]["strategy"]["matrix"]["include"];
    let platforms: Vec<&str> = matrix
        .as_sequence()
        .expect("build-tauri matrix.include should be a sequence")
        .iter()
        .filter_map(|entry| entry["platform"].as_str())
        .collect();

    assert!(
        platforms.iter().any(|p| p.contains("ubuntu")),
        "Release workflow should build on Linux, got: {:?}",
        platforms
    );
    assert!(
        platforms.iter().any(|p| p.contains("macos")),
        "Release workflow should build on macOS, got: {:?}",
        platforms
    );
    assert!(
        platforms.iter().any(|p| p.contains("windows")),
        "Release workflow should build on Windows, got: {:?}",
        platforms
    );
}

#[test]
fn ci_workflow_supports_workflow_call() {
    let workflow = read_yaml(&workspace_root().join(".github/workflows/ci.yml"));
    let on = workflow["on"]
        .as_mapping()
        .expect("on: should be a mapping");
    let has_workflow_call = on.keys().any(|k| k.as_str() == Some("workflow_call"));
    assert!(
        has_workflow_call,
        "CI workflow should support workflow_call trigger"
    );
}

// --- Justfile tests ---

#[test]
fn justfile_has_release_targets() {
    let root = workspace_root();
    let content = fs::read_to_string(root.join("justfile")).expect("Should read justfile");

    assert!(
        content.contains("release:") || content.contains("release :"),
        "justfile should have a 'release' target"
    );
    assert!(
        content.contains("release-cli:") || content.contains("release-cli :"),
        "justfile should have a 'release-cli' target"
    );
    assert!(
        content.contains("release-all:") || content.contains("release-all :"),
        "justfile should have a 'release-all' target"
    );
}
