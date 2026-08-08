package router

type HealthRouter struct {
    Path string
}

func NewHealthRouter() HealthRouter {
    return HealthRouter{Path: "/health"}
}
