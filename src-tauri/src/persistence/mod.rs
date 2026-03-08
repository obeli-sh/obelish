pub mod fs;
pub mod session;

use crate::error::PersistenceError;

pub trait PersistenceBackend: Send + Sync {
    fn save(&self, key: &str, data: &[u8]) -> Result<(), PersistenceError>;
    fn load(&self, key: &str) -> Result<Option<Vec<u8>>, PersistenceError>;
    fn delete(&self, key: &str) -> Result<(), PersistenceError>;
}
