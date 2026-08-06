package tests

import (
    "testing"
    "example.com/benchmark/internal/router"
)

func TestHealthRouter(t *testing.T) {
    if router.NewHealthRouter().Path != "/health" {
        t.Fatal("unexpected route")
    }
}
