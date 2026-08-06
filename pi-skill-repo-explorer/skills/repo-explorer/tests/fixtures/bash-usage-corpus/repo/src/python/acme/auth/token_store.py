TOKENS: list[str] = []


def save_token(token: str) -> str:
    TOKENS.append(token)
    return token
