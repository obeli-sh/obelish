use obelisk_protocol::Notification;

pub struct NotificationStore {
    notifications: Vec<Notification>,
    max_count: usize,
}

impl NotificationStore {
    pub fn new(max_count: usize) -> Self {
        Self {
            notifications: Vec::new(),
            max_count,
        }
    }

    pub fn add(&mut self, notification: Notification) {
        self.notifications.insert(0, notification);
        if self.notifications.len() > self.max_count {
            self.notifications.pop();
        }
    }

    pub fn list(&self) -> &[Notification] {
        &self.notifications
    }

    pub fn list_by_pane(&self, pane_id: &str) -> Vec<&Notification> {
        self.notifications
            .iter()
            .filter(|n| n.pane_id == pane_id)
            .collect()
    }

    pub fn mark_read(&mut self, id: &str) {
        if let Some(n) = self.notifications.iter_mut().find(|n| n.id == id) {
            n.read = true;
        }
    }

    pub fn unread_count(&self) -> usize {
        self.notifications.iter().filter(|n| !n.read).count()
    }

    pub fn unread_count_by_pane(&self, pane_id: &str) -> usize {
        self.notifications
            .iter()
            .filter(|n| n.pane_id == pane_id && !n.read)
            .count()
    }

    pub fn clear(&mut self) {
        self.notifications.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_notification(id: &str, pane_id: &str) -> Notification {
        Notification {
            id: id.to_string(),
            pane_id: pane_id.to_string(),
            workspace_id: "ws-1".to_string(),
            osc_type: 9,
            title: format!("Title {id}"),
            body: None,
            timestamp: 1000,
            read: false,
        }
    }

    #[test]
    fn starts_empty() {
        let store = NotificationStore::new(1000);
        assert_eq!(store.list().len(), 0);
        assert_eq!(store.unread_count(), 0);
    }

    #[test]
    fn add_increments_count() {
        let mut store = NotificationStore::new(1000);
        store.add(make_notification("n1", "pane-1"));
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn list_returns_all() {
        let mut store = NotificationStore::new(1000);
        store.add(make_notification("n1", "pane-1"));
        store.add(make_notification("n2", "pane-1"));
        store.add(make_notification("n3", "pane-2"));
        assert_eq!(store.list().len(), 3);
    }

    #[test]
    fn list_by_pane() {
        let mut store = NotificationStore::new(1000);
        store.add(make_notification("n1", "pane-1"));
        store.add(make_notification("n2", "pane-2"));
        store.add(make_notification("n3", "pane-1"));

        let pane1 = store.list_by_pane("pane-1");
        assert_eq!(pane1.len(), 2);
        assert!(pane1.iter().all(|n| n.pane_id == "pane-1"));

        let pane2 = store.list_by_pane("pane-2");
        assert_eq!(pane2.len(), 1);
        assert_eq!(pane2[0].id, "n2");
    }

    #[test]
    fn mark_read() {
        let mut store = NotificationStore::new(1000);
        store.add(make_notification("n1", "pane-1"));
        assert!(!store.list()[0].read);
        assert_eq!(store.unread_count(), 1);

        store.mark_read("n1");
        assert!(store.list()[0].read);
        assert_eq!(store.unread_count(), 0);
    }

    #[test]
    fn mark_read_nonexistent() {
        let mut store = NotificationStore::new(1000);
        store.add(make_notification("n1", "pane-1"));
        store.mark_read("nonexistent");
        assert_eq!(store.unread_count(), 1);
    }

    #[test]
    fn unread_count() {
        let mut store = NotificationStore::new(1000);
        store.add(make_notification("n1", "pane-1"));
        store.add(make_notification("n2", "pane-1"));
        store.add(make_notification("n3", "pane-1"));
        assert_eq!(store.unread_count(), 3);

        store.mark_read("n1");
        assert_eq!(store.unread_count(), 2);
    }

    #[test]
    fn unread_count_by_pane() {
        let mut store = NotificationStore::new(1000);
        store.add(make_notification("n1", "pane-1"));
        store.add(make_notification("n2", "pane-2"));
        store.add(make_notification("n3", "pane-1"));

        assert_eq!(store.unread_count_by_pane("pane-1"), 2);
        assert_eq!(store.unread_count_by_pane("pane-2"), 1);

        store.mark_read("n1");
        assert_eq!(store.unread_count_by_pane("pane-1"), 1);
        assert_eq!(store.unread_count_by_pane("pane-2"), 1);
    }

    #[test]
    fn max_count_eviction() {
        let mut store = NotificationStore::new(1000);
        for i in 0..1001 {
            store.add(make_notification(&format!("n{i}"), "pane-1"));
        }
        assert_eq!(store.list().len(), 1000);
        // Newest should be first (n1000), oldest surviving should be n1
        assert_eq!(store.list()[0].id, "n1000");
        assert_eq!(store.list()[999].id, "n1");
    }

    #[test]
    fn clear_removes_all() {
        let mut store = NotificationStore::new(1000);
        store.add(make_notification("n1", "pane-1"));
        store.add(make_notification("n2", "pane-2"));
        assert_eq!(store.list().len(), 2);

        store.clear();
        assert_eq!(store.list().len(), 0);
        assert_eq!(store.unread_count(), 0);
    }
}
