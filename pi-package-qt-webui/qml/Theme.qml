import QtQuick
import Quickshell

QtObject {
    id: theme

    readonly property string requestedMode: String(Quickshell.env("QT_WEBUI_THEME_MODE")).toLowerCase()
    readonly property string portalMode: String(Quickshell.env("QT_WEBUI_SYSTEM_COLOR_SCHEME")).toLowerCase()
    readonly property bool dark: requestedMode === "dark"
        || (requestedMode !== "light"
            && (portalMode === "dark"
                || (portalMode !== "light" && Qt.styleHints.colorScheme === Qt.Dark)))

    readonly property color windowBackground: dark ? "#0f172a" : "#f8fafc"
    readonly property color surface: dark ? "#111827" : "#ffffff"
    readonly property color assistantBubble: dark ? "#1e293b" : "#f1f5f9"
    readonly property color userBubble: dark ? "#172554" : "#dbeafe"
    readonly property color foreground: dark ? "#e2e8f0" : "#0f172a"
    readonly property color muted: dark ? "#94a3b8" : "#64748b"
    readonly property color border: dark ? "#475569" : "#cbd5e1"
    readonly property color accent: dark ? "#3b82f6" : "#2563eb"
    readonly property color accentForeground: dark ? "#bfdbfe" : "#1d4ed8"
    readonly property color userBorder: dark ? "#1d4ed8" : "#93c5fd"
    readonly property color assistantBorder: dark ? "#475569" : "#cbd5e1"
    readonly property color disabledSurface: dark ? "#334155" : "#e2e8f0"
    readonly property color disabledForeground: dark ? "#94a3b8" : "#64748b"
    readonly property color buttonForeground: "#ffffff"
    readonly property color destructive: dark ? "#ef4444" : "#dc2626"
    readonly property color warning: dark ? "#f59e0b" : "#d97706"

    readonly property color readyBackground: dark ? "#052e16" : "#dcfce7"
    readonly property color readyBorder: dark ? "#166534" : "#86efac"
    readonly property color readyForeground: dark ? "#86efac" : "#166534"
    readonly property color runningBackground: dark ? "#172554" : "#dbeafe"
    readonly property color runningBorder: dark ? "#1d4ed8" : "#93c5fd"
    readonly property color runningForeground: dark ? "#93c5fd" : "#1d4ed8"
    readonly property color toolBackground: dark ? "#422006" : "#fef3c7"
    readonly property color toolBorder: dark ? "#92400e" : "#fcd34d"
    readonly property color toolForeground: dark ? "#fcd34d" : "#92400e"
    readonly property color errorBackground: dark ? "#450a0a" : "#fee2e2"
    readonly property color errorBorder: dark ? "#991b1b" : "#fca5a5"
    readonly property color errorForeground: dark ? "#fca5a5" : "#991b1b"
    readonly property color neutralBackground: dark ? "#1e293b" : "#e2e8f0"
    readonly property color neutralBorder: dark ? "#475569" : "#cbd5e1"
    readonly property color neutralForeground: dark ? "#cbd5e1" : "#475569"
    readonly property color errorPanelBackground: dark ? "#4c0519" : "#fff1f2"
    readonly property color errorPanelBorder: dark ? "#9f1239" : "#fecdd3"
    readonly property color errorPanelForeground: dark ? "#fda4af" : "#9f1239"

    function statusBackground(kind) {
        if (kind === "ready") return readyBackground
        if (kind === "running") return runningBackground
        if (kind === "tool") return toolBackground
        if (kind === "error") return errorBackground
        return neutralBackground
    }

    function statusBorder(kind) {
        if (kind === "ready") return readyBorder
        if (kind === "running") return runningBorder
        if (kind === "tool") return toolBorder
        if (kind === "error") return errorBorder
        return neutralBorder
    }

    function statusForeground(kind) {
        if (kind === "ready") return readyForeground
        if (kind === "running") return runningForeground
        if (kind === "tool") return toolForeground
        if (kind === "error") return errorForeground
        return neutralForeground
    }
}
