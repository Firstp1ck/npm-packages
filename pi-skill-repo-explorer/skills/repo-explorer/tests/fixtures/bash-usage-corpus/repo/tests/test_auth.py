from src.python.acme.auth.service import authenticate_user


def test_authenticate_user() -> None:
    assert authenticate_user("fixture") == "session-fixture"
