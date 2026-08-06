pub struct Session {
    pub user_id: String,
}

impl Session {
    pub fn new(user_id: &str) -> Self {
        Self { user_id: user_id.to_owned() }
    }
}
