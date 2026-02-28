use obelisk_protocol::GitInfo;

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
                Some(Err(_)) => Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "mock error",
                )),
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
        runner.on(
            "symbolic-ref --short HEAD",
            Ok("main\n".to_string()),
        );
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
            Err(std::io::Error::new(std::io::ErrorKind::Other, "not a git repo")),
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
            Err(std::io::Error::new(std::io::ErrorKind::Other, "no upstream")),
        );

        let info = get_git_info(&runner, "/fake/path").unwrap();
        assert_eq!(info.branch, None);
        assert!(!info.is_dirty);
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);
    }
}
