use crate::session::Session;

pub fn authenticate_request(user_id: &str) -> Session {
    Session::new(user_id)
}
