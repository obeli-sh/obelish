#![no_main]

use libfuzzer_sys::fuzz_target;
use obelisk_lib::metadata::git::{
    parse_ahead_behind, parse_branch, parse_dirty_status, parse_worktree_list,
};

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        let _ = parse_branch(s);
        let _ = parse_dirty_status(s);
        let _ = parse_ahead_behind(s);
        let _ = parse_worktree_list(s);
    }
});
