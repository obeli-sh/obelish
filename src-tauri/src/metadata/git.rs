use obelisk_protocol::{GitInfo, WorktreeInfo};

pub trait CommandRunner: Send + Sync {
    fn run_command(
        &self,
        program: &str,
        args: &[&str],
        cwd: &str,
    ) -> Result<String, std::io::Error>;
}

pub struct RealCommandRunner;

impl CommandRunner for RealCommandRunner {
    fn run_command(
        &self,
        program: &str,
        args: &[&str],
        cwd: &str,
    ) -> Result<String, std::io::Error> {
        let output = std::process::Command::new(program)
            .args(args)
            .current_dir(cwd)
            .output()?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(std::io::Error::other(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ))
        }
    }
}

pub fn parse_branch(output: &str) -> Option<String> {
    let trimmed = output.trim();
    if trimmed.is_empty() || trimmed == "HEAD" {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn parse_dirty_status(output: &str) -> bool {
    !output.trim().is_empty()
}

pub fn parse_ahead_behind(output: &str) -> (u32, u32) {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return (0, 0);
    }
    let parts: Vec<&str> = trimmed.split('\t').collect();
    let behind = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let ahead = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    (ahead, behind)
}

pub fn get_git_info(runner: &dyn CommandRunner, cwd: &str) -> Option<GitInfo> {
    runner
        .run_command("git", &["rev-parse", "--is-inside-work-tree"], cwd)
        .ok()?;

    let branch = runner
        .run_command("git", &["symbolic-ref", "--short", "HEAD"], cwd)
        .ok()
        .and_then(|output| parse_branch(&output));

    let is_dirty = runner
        .run_command("git", &["status", "--porcelain"], cwd)
        .map(|output| parse_dirty_status(&output))
        .unwrap_or(false);

    let (ahead, behind) = runner
        .run_command(
            "git",
            &["rev-list", "--count", "--left-right", "@{upstream}...HEAD"],
            cwd,
        )
        .map(|output| parse_ahead_behind(&output))
        .unwrap_or((0, 0));

    Some(GitInfo {
        branch,
        is_dirty,
        ahead,
        behind,
    })
}

pub fn parse_worktree_list(output: &str) -> Vec<WorktreeInfo> {
    let mut worktrees = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;
    let mut is_first = true;

    for line in output.lines() {
        if line.is_empty() {
            if let Some(path) = current_path.take() {
                worktrees.push(WorktreeInfo {
                    path,
                    branch: current_branch.take(),
                    is_main: is_first,
                });
                is_first = false;
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("worktree ") {
            current_path = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("branch refs/heads/") {
            current_branch = Some(rest.to_string());
        }
    }

    // Handle last block if no trailing newline
    if let Some(path) = current_path {
        worktrees.push(WorktreeInfo {
            path,
            branch: current_branch,
            is_main: is_first,
        });
    }

    worktrees
}

pub fn list_worktrees(runner: &dyn CommandRunner, root_path: &str) -> Vec<WorktreeInfo> {
    match runner.run_command("git", &["worktree", "list", "--porcelain"], root_path) {
        Ok(output) => parse_worktree_list(&output),
        Err(_) => {
            // Not a git repo or git not available — return root as sole "worktree"
            vec![WorktreeInfo {
                path: root_path.to_string(),
                branch: None,
                is_main: true,
            }]
        }
    }
}

pub fn create_worktree(
    runner: &dyn CommandRunner,
    root_path: &str,
    branch_name: &str,
    worktree_path: &str,
) -> Result<WorktreeInfo, std::io::Error> {
    runner.run_command(
        "git",
        &["worktree", "add", "-b", branch_name, worktree_path],
        root_path,
    )?;

    // Get the branch of the newly created worktree
    let branch = runner
        .run_command("git", &["symbolic-ref", "--short", "HEAD"], worktree_path)
        .ok()
        .and_then(|o| parse_branch(&o));

    Ok(WorktreeInfo {
        path: worktree_path.to_string(),
        branch,
        is_main: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockRunner {
        responses: std::collections::HashMap<String, Result<String, std::io::Error>>,
    }

    impl MockRunner {
        fn new() -> Self {
            Self {
                responses: std::collections::HashMap::new(),
            }
        }

        fn on(&mut self, args_key: &str, result: Result<String, std::io::Error>) {
            self.responses.insert(args_key.to_string(), result);
        }
    }

    impl CommandRunner for MockRunner {
        fn run_command(
            &self,
            _program: &str,
            args: &[&str],
            _cwd: &str,
        ) -> Result<String, std::io::Error> {
            let key = args.join(" ");
            match self.responses.get(&key) {
                Some(Ok(output)) => Ok(output.clone()),
                Some(Err(_)) => Err(std::io::Error::new(std::io::ErrorKind::Other, "mock error")),
                None => Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("no mock for args: {key}"),
                )),
            }
        }
    }

    // --- parse_branch tests ---

    #[test]
    fn parse_branch_main() {
        assert_eq!(parse_branch("main\n"), Some("main".to_string()));
    }

    #[test]
    fn parse_branch_feature_with_slash() {
        assert_eq!(
            parse_branch("feature/add-login\n"),
            Some("feature/add-login".to_string())
        );
    }

    #[test]
    fn parse_detached_head() {
        assert_eq!(parse_branch("HEAD\n"), None);
    }

    // --- parse_dirty_status tests ---

    #[test]
    fn parse_dirty_status_with_changes() {
        assert!(parse_dirty_status(" M src/main.rs\n?? new.txt\n"));
    }

    #[test]
    fn parse_clean_status() {
        assert!(!parse_dirty_status(""));
    }

    // --- parse_ahead_behind tests ---

    #[test]
    fn parse_ahead_behind_both() {
        // rev-list --left-right @{upstream}...HEAD outputs: behind\tahead
        assert_eq!(parse_ahead_behind("2\t3\n"), (3, 2));
    }

    #[test]
    fn parse_ahead_behind_none() {
        assert_eq!(parse_ahead_behind(""), (0, 0));
    }

    // --- get_git_info tests ---

    #[test]
    fn get_git_info_from_mock_runner() {
        let mut runner = MockRunner::new();
        runner.on("rev-parse --is-inside-work-tree", Ok("true\n".to_string()));
        runner.on("symbolic-ref --short HEAD", Ok("main\n".to_string()));
        runner.on("status --porcelain", Ok(" M src/main.rs\n".to_string()));
        runner.on(
            "rev-list --count --left-right @{upstream}...HEAD",
            Ok("2\t3\n".to_string()),
        );

        let info = get_git_info(&runner, "/fake/path").unwrap();
        assert_eq!(info.branch, Some("main".to_string()));
        assert!(info.is_dirty);
        assert_eq!(info.ahead, 3);
        assert_eq!(info.behind, 2);
    }

    #[test]
    fn get_git_info_non_git_dir() {
        let mut runner = MockRunner::new();
        runner.on(
            "rev-parse --is-inside-work-tree",
            Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "not a git repo",
            )),
        );

        assert!(get_git_info(&runner, "/not/a/repo").is_none());
    }

    #[test]
    fn get_git_info_handles_command_failure() {
        let mut runner = MockRunner::new();
        runner.on("rev-parse --is-inside-work-tree", Ok("true\n".to_string()));
        runner.on(
            "symbolic-ref --short HEAD",
            Err(std::io::Error::new(std::io::ErrorKind::Other, "detached")),
        );
        runner.on("status --porcelain", Ok("".to_string()));
        runner.on(
            "rev-list --count --left-right @{upstream}...HEAD",
            Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "no upstream",
            )),
        );

        let info = get_git_info(&runner, "/fake/path").unwrap();
        assert_eq!(info.branch, None);
        assert!(!info.is_dirty);
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);
    }

    // --- parse_worktree_list tests ---

    #[test]
    fn parse_worktree_list_single_main() {
        let output = "worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n";
        let worktrees = parse_worktree_list(output);
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].path, "/home/user/project");
        assert_eq!(worktrees[0].branch, Some("main".to_string()));
        assert!(worktrees[0].is_main);
    }

    #[test]
    fn parse_worktree_list_multiple() {
        let output = "worktree /home/user/project\nHEAD abc\nbranch refs/heads/main\n\nworktree /home/user/project-feature\nHEAD def\nbranch refs/heads/feature-x\n\n";
        let worktrees = parse_worktree_list(output);
        assert_eq!(worktrees.len(), 2);
        assert!(worktrees[0].is_main);
        assert_eq!(worktrees[0].branch, Some("main".to_string()));
        assert!(!worktrees[1].is_main);
        assert_eq!(worktrees[1].branch, Some("feature-x".to_string()));
    }

    #[test]
    fn parse_worktree_list_detached_head() {
        let output = "worktree /home/user/project\nHEAD abc123\ndetached\n\n";
        let worktrees = parse_worktree_list(output);
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].branch, None);
    }

    #[test]
    fn parse_worktree_list_empty_output() {
        let worktrees = parse_worktree_list("");
        assert!(worktrees.is_empty());
    }

    #[test]
    fn parse_worktree_list_no_trailing_newline() {
        let output = "worktree /home/user/project\nHEAD abc\nbranch refs/heads/main";
        let worktrees = parse_worktree_list(output);
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].path, "/home/user/project");
    }

    // --- list_worktrees tests ---

    #[test]
    fn list_worktrees_from_mock() {
        let mut runner = MockRunner::new();
        runner.on(
            "worktree list --porcelain",
            Ok("worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feat\nHEAD def\nbranch refs/heads/feat\n\n".to_string()),
        );
        let worktrees = list_worktrees(&runner, "/repo");
        assert_eq!(worktrees.len(), 2);
        assert!(worktrees[0].is_main);
        assert!(!worktrees[1].is_main);
    }

    #[test]
    fn list_worktrees_non_git_dir_returns_root() {
        let mut runner = MockRunner::new();
        runner.on(
            "worktree list --porcelain",
            Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "not a git repo",
            )),
        );
        let worktrees = list_worktrees(&runner, "/not-a-repo");
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].path, "/not-a-repo");
        assert!(worktrees[0].is_main);
        assert_eq!(worktrees[0].branch, None);
    }

    // --- create_worktree tests ---

    #[test]
    fn create_worktree_success() {
        let mut runner = MockRunner::new();
        runner.on(
            "worktree add -b new-feature /repo/wt-new-feature",
            Ok("Preparing worktree\n".to_string()),
        );
        runner.on("symbolic-ref --short HEAD", Ok("new-feature\n".to_string()));
        let wt = create_worktree(&runner, "/repo", "new-feature", "/repo/wt-new-feature").unwrap();
        assert_eq!(wt.path, "/repo/wt-new-feature");
        assert_eq!(wt.branch, Some("new-feature".to_string()));
        assert!(!wt.is_main);
    }

    #[test]
    fn create_worktree_failure() {
        let mut runner = MockRunner::new();
        runner.on(
            "worktree add -b existing /repo/wt-existing",
            Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "branch already exists",
            )),
        );
        let result = create_worktree(&runner, "/repo", "existing", "/repo/wt-existing");
        assert!(result.is_err());
    }
}
