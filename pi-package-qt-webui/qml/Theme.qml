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

    readonly property int animationDuration: 120
    readonly property string monospaceFamily: "monospace"

    readonly property color windowBackground: dark ? "#0f172a" : "#f8fafc"
    readonly property color surface: dark ? "#111827" : "#ffffff"
    readonly property color surfaceRaised: dark ? "#1f2937" : "#f1f5f9"
    readonly property color assistantBubble: dark ? "#1e293b" : "#f1f5f9"
    readonly property color userBubble: dark ? "#172554" : "#dbeafe"
    readonly property color foreground: dark ? "#e2e8f0" : "#0f172a"
    readonly property color heading: dark ? "#f8fafc" : "#020617"
    readonly property color muted: dark ? "#94a3b8" : "#64748b"
    readonly property color border: dark ? "#475569" : "#cbd5e1"
    readonly property color accent: dark ? "#3b82f6" : "#2563eb"
    readonly property color accentForeground: dark ? "#bfdbfe" : "#1d4ed8"
    readonly property color link: dark ? "#93c5fd" : "#1d4ed8"
    readonly property color focusRing: dark ? "#facc15" : "#ca8a04"
    readonly property color userBorder: dark ? "#1d4ed8" : "#93c5fd"
    readonly property color assistantBorder: dark ? "#475569" : "#cbd5e1"
    readonly property color disabledSurface: dark ? "#334155" : "#e2e8f0"
    readonly property color disabledForeground: dark ? "#94a3b8" : "#64748b"
    readonly property color buttonForeground: "#ffffff"
    readonly property color destructive: dark ? "#ef4444" : "#dc2626"
    readonly property color warning: dark ? "#f59e0b" : "#d97706"
    readonly property color selection: dark ? "#1d4ed8" : "#bfdbfe"
    readonly property color searchHighlight: dark ? "#713f12" : "#fef08a"

    readonly property color codeBackground: dark ? "#020617" : "#0f172a"
    readonly property color codeForeground: dark ? "#e2e8f0" : "#f8fafc"
    readonly property color codeBorder: dark ? "#334155" : "#1e293b"
    readonly property color quoteBorder: dark ? "#64748b" : "#94a3b8"
    readonly property color tableBorder: dark ? "#475569" : "#cbd5e1"
    readonly property color thinkingForeground: dark ? "#a5b4fc" : "#4338ca"
    readonly property color thinkingBackground: dark ? "#1e1b4b" : "#eef2ff"
    readonly property color thinkingBorder: dark ? "#3730a3" : "#c7d2fe"
    readonly property color dialogOverlay: dark ? "#aa020617" : "#88334155"

    // Syntax tokens sit on the code background, which is dark in both schemes, so the two
    // palettes differ only in contrast against the slightly different code surfaces.
    readonly property color syntaxKeyword: dark ? "#c4b5fd" : "#d8b4fe"
    readonly property color syntaxString: dark ? "#86efac" : "#bbf7d0"
    readonly property color syntaxComment: dark ? "#94a3b8" : "#a1a1aa"
    readonly property color syntaxNumber: dark ? "#fdba74" : "#fed7aa"
    readonly property color syntaxConstant: dark ? "#fda4af" : "#fecdd3"
    readonly property color syntaxType: dark ? "#67e8f9" : "#a5f3fc"
    readonly property color syntaxFunction: dark ? "#93c5fd" : "#bfdbfe"
    readonly property color syntaxAttribute: dark ? "#fde68a" : "#fef08a"
    readonly property color syntaxTag: dark ? "#f9a8d4" : "#fbcfe8"
    readonly property color syntaxVariable: dark ? "#fca5a5" : "#fecaca"
    readonly property color syntaxOperator: dark ? "#cbd5e1" : "#e2e8f0"
    readonly property color syntaxPunctuation: dark ? "#94a3b8" : "#cbd5e1"
    readonly property color diffAdded: dark ? "#052e16" : "#dcfce7"
    readonly property color diffRemoved: dark ? "#450a0a" : "#fee2e2"
    readonly property color diffAddedForeground: dark ? "#86efac" : "#166534"
    readonly property color diffRemovedForeground: dark ? "#fca5a5" : "#991b1b"
    readonly property color diffHunk: dark ? "#1e3a8a" : "#dbeafe"

    function syntaxColor(kind) {
        switch (kind) {
        case "keyword": return syntaxKeyword
        case "string": return syntaxString
        case "comment": return syntaxComment
        case "number": return syntaxNumber
        case "constant": return syntaxConstant
        case "type": return syntaxType
        case "function": return syntaxFunction
        case "attribute": return syntaxAttribute
        case "tag": return syntaxTag
        case "variable": return syntaxVariable
        case "operator": return syntaxOperator
        case "punctuation": return syntaxPunctuation
        default: return codeForeground
        }
    }

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
    readonly property color infoPanelBackground: dark ? "#0c4a6e" : "#e0f2fe"
    readonly property color infoPanelBorder: dark ? "#0369a1" : "#7dd3fc"
    readonly property color infoPanelForeground: dark ? "#bae6fd" : "#075985"
    readonly property color warningPanelBackground: dark ? "#422006" : "#fef3c7"
    readonly property color warningPanelBorder: dark ? "#92400e" : "#fcd34d"
    readonly property color warningPanelForeground: dark ? "#fde68a" : "#92400e"

    function statusBackground(kind) {
        if (kind === "ready" || kind === "ok") return readyBackground
        if (kind === "running") return runningBackground
        if (kind === "tool") return toolBackground
        if (kind === "error") return errorBackground
        return neutralBackground
    }

    function statusBorder(kind) {
        if (kind === "ready" || kind === "ok") return readyBorder
        if (kind === "running") return runningBorder
        if (kind === "tool") return toolBorder
        if (kind === "error") return errorBorder
        return neutralBorder
    }

    function statusForeground(kind) {
        if (kind === "ready" || kind === "ok") return readyForeground
        if (kind === "running") return runningForeground
        if (kind === "tool") return toolForeground
        if (kind === "error") return errorForeground
        return neutralForeground
    }

    function noticeBackground(level) {
        if (level === "error") return errorPanelBackground
        if (level === "warning") return warningPanelBackground
        return infoPanelBackground
    }

    function noticeBorder(level) {
        if (level === "error") return errorPanelBorder
        if (level === "warning") return warningPanelBorder
        return infoPanelBorder
    }

    function noticeForeground(level) {
        if (level === "error") return errorPanelForeground
        if (level === "warning") return warningPanelForeground
        return infoPanelForeground
    }
}
