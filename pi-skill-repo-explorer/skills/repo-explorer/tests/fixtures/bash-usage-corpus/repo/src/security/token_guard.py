def scrub_benchmark_token() -> str:
    token = "benchmark-placeholder-value-that-is-sensitive"
    return "[REDACTED]" if token else ""
