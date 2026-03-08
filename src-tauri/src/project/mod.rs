use std::sync::Arc;

use crate::error::PersistenceError;
use crate::persistence::PersistenceBackend;
use obelisk_protocol::ProjectInfo;

const PROJECTS_KEY: &str = "projects";

pub struct ProjectStore {
    projects: Vec<ProjectInfo>,
    backend: Arc<dyn PersistenceBackend>,
}

impl ProjectStore {
    pub fn new(backend: Arc<dyn PersistenceBackend>) -> Self {
        Self {
            projects: Vec::new(),
            backend,
        }
    }

    /// Load projects from persistence. Call once at startup.
    pub fn load(&mut self) -> Result<(), PersistenceError> {
        match self.backend.load(PROJECTS_KEY)? {
            Some(data) => {
                self.projects =
                    serde_json::from_slice(&data).map_err(|e| PersistenceError::Corrupted {
                        reason: format!("Failed to deserialize projects: {e}"),
                    })?;
                Ok(())
            }
            None => Ok(()),
        }
    }

    /// Save projects to persistence.
    pub fn save(&self) -> Result<(), PersistenceError> {
        let data = serde_json::to_vec_pretty(&self.projects)?;
        self.backend.save(PROJECTS_KEY, &data)?;
        Ok(())
    }

    /// Add a project by root path. If a project with the same root_path already exists, return it (idempotent).
    /// Name is derived from the last component of the path.
    pub fn add(&mut self, root_path: String) -> Result<ProjectInfo, PersistenceError> {
        // Normalize path (remove trailing slash)
        let normalized = root_path
            .trim_end_matches('/')
            .trim_end_matches('\\')
            .to_string();

        // Check for existing project with same path
        if let Some(existing) = self.projects.iter().find(|p| p.root_path == normalized) {
            return Ok(existing.clone());
        }

        let name = std::path::Path::new(&normalized)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| normalized.clone());

        let project = ProjectInfo {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            root_path: normalized,
        };

        self.projects.push(project.clone());
        self.save()?;
        Ok(project)
    }

    /// Remove a project by ID.
    pub fn remove(&mut self, project_id: &str) -> Result<(), PersistenceError> {
        let before = self.projects.len();
        self.projects.retain(|p| p.id != project_id);
        if self.projects.len() == before {
            return Ok(()); // Not found, no-op
        }
        self.save()?;
        Ok(())
    }

    pub fn list(&self) -> &[ProjectInfo] {
        &self.projects
    }

    pub fn get(&self, project_id: &str) -> Option<&ProjectInfo> {
        self.projects.iter().find(|p| p.id == project_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::fs::FsPersistence;
    use tempfile::TempDir;

    fn setup() -> (TempDir, ProjectStore) {
        let dir = TempDir::new().unwrap();
        let backend = Arc::new(FsPersistence::new(dir.path()).unwrap());
        let store = ProjectStore::new(backend);
        (dir, store)
    }

    #[test]
    fn add_project_creates_with_derived_name() {
        let (_dir, mut store) = setup();
        let project = store
            .add("/home/user/projects/obelisk".to_string())
            .unwrap();
        assert_eq!(project.name, "obelisk");
        assert_eq!(project.root_path, "/home/user/projects/obelisk");
        assert!(!project.id.is_empty());
    }

    #[test]
    fn add_project_normalizes_trailing_slash() {
        let (_dir, mut store) = setup();
        let project = store
            .add("/home/user/projects/obelisk/".to_string())
            .unwrap();
        assert_eq!(project.root_path, "/home/user/projects/obelisk");
    }

    #[test]
    fn add_duplicate_path_returns_existing() {
        let (_dir, mut store) = setup();
        let p1 = store.add("/home/user/myproject".to_string()).unwrap();
        let p2 = store.add("/home/user/myproject".to_string()).unwrap();
        assert_eq!(p1.id, p2.id);
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn remove_project() {
        let (_dir, mut store) = setup();
        let project = store.add("/home/user/myproject".to_string()).unwrap();
        assert_eq!(store.list().len(), 1);
        store.remove(&project.id).unwrap();
        assert_eq!(store.list().len(), 0);
    }

    #[test]
    fn remove_nonexistent_is_noop() {
        let (_dir, mut store) = setup();
        store.remove("nonexistent-id").unwrap();
    }

    #[test]
    fn get_project_by_id() {
        let (_dir, mut store) = setup();
        let project = store.add("/home/user/myproject".to_string()).unwrap();
        let found = store.get(&project.id).unwrap();
        assert_eq!(found.root_path, "/home/user/myproject");
    }

    #[test]
    fn get_nonexistent_returns_none() {
        let (_dir, store) = setup();
        assert!(store.get("nonexistent").is_none());
    }

    #[test]
    fn save_load_roundtrip() {
        let (dir, mut store) = setup();
        store.add("/home/user/project-a".to_string()).unwrap();
        store.add("/home/user/project-b".to_string()).unwrap();

        // Create new store with same backend
        let backend = Arc::new(FsPersistence::new(dir.path()).unwrap());
        let mut store2 = ProjectStore::new(backend);
        store2.load().unwrap();

        assert_eq!(store2.list().len(), 2);
        assert_eq!(store2.list()[0].name, "project-a");
        assert_eq!(store2.list()[1].name, "project-b");
    }

    #[test]
    fn load_with_no_saved_data_returns_empty() {
        let (_dir, mut store) = setup();
        store.load().unwrap();
        assert!(store.list().is_empty());
    }

    #[test]
    fn list_returns_all_projects() {
        let (_dir, mut store) = setup();
        store.add("/a".to_string()).unwrap();
        store.add("/b".to_string()).unwrap();
        store.add("/c".to_string()).unwrap();
        assert_eq!(store.list().len(), 3);
    }
}
