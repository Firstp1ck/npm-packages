from token_store import save_token


def authenticate_user(user_id: str) -> str:
    token = f"session-{user_id}"
    return save_token(token)
