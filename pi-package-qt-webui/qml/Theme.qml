import QtQuick

QtObject {
    id: theme

    property string requestedMode: "automatic"
    property string portalMode: "unknown"
    property bool reducedMotion: false
    property int desktopCornerRadius: 0
    property int desktopEdgeGap: 8
    property var themeState: null
    readonly property var paletteRoleNames: [
        "mainSurface", "sidebarSurface", "sidebarBorder", "panelSurface", "windowBackground", "surface", "surfaceRaised", "assistantBubble", "userBubble",
        "foreground", "heading", "muted", "border", "frameBorder", "accent", "accentForeground", "link", "focusRing", "userBorder", "assistantBorder",
        "controlSurface", "controlHover", "controlPressed", "controlActive", "controlSelected", "controlBorder", "controlActiveBorder", "controlSelectedBorder",
        "disabledSurface", "disabledForeground", "primaryButtonBackground", "primaryButtonHover", "primaryButtonPressed", "primaryButtonForeground", "primaryButtonHoverForeground", "primaryButtonPressedForeground",
        "destructiveButtonBackground", "destructiveButtonHover", "destructiveButtonPressed", "destructiveButtonForeground", "destructiveButtonHoverForeground", "destructiveButtonPressedForeground",
        "warningButtonBackground", "warningButtonHover", "warningButtonPressed", "warningButtonForeground", "buttonForeground", "composerSurface", "composerBorder",
        "destructive", "warning", "urgentBackground", "urgentBorder", "urgentForeground", "selection", "selectionForeground", "searchHighlight",
        "codeBackground", "codeForeground", "codeBorder", "quoteBorder", "tableBorder", "thinkingForeground", "thinkingBackground", "thinkingBorder", "dialogOverlay",
        "syntaxKeyword", "syntaxString", "syntaxComment", "syntaxNumber", "syntaxConstant", "syntaxType", "syntaxFunction", "syntaxAttribute", "syntaxTag", "syntaxVariable", "syntaxOperator", "syntaxPunctuation",
        "diffAdded", "diffRemoved", "diffAddedForeground", "diffRemovedForeground", "diffHunk", "success", "readyBackground", "readyBorder", "readyForeground",
        "runningBackground", "runningBorder", "runningForeground", "toolBackground", "toolBorder", "toolForeground", "errorBackground", "errorBorder", "errorForeground",
        "neutralBackground", "neutralBorder", "neutralForeground", "errorPanelBackground", "errorPanelBorder", "errorPanelForeground", "infoPanelBackground", "infoPanelBorder", "infoPanelForeground",
        "warningPanelBackground", "warningPanelBorder", "warningPanelForeground"
    ]
    readonly property var externalPalette: completeExternalPalette(themeState)

    function completeExternalPalette(state) {
        if (!state || typeof state !== "object" || !state.effective || state.effective.kind !== "external"
                || !state.palette || typeof state.palette !== "object") return null
        for (const role of paletteRoleNames) if (typeof state.palette[role] !== "string") return null
        return state.palette
    }

    function themedColor(role, fallback) {
        return externalPalette ? externalPalette[role] : fallback
    }

    readonly property bool dark: requestedMode === "dark"
        || (requestedMode !== "light"
            && (portalMode === "dark"
                || (portalMode !== "light" && Qt.styleHints.colorScheme === Qt.Dark)))

    // One 12px-based scale owns spacing, type, geometry, borders, and motion.
    readonly property int spaceXxs: 2
    readonly property int spaceXs: 4
    readonly property int spaceSm: 6
    readonly property int spaceMd: 8
    readonly property int spaceLg: 10
    readonly property int spaceXl: 12
    readonly property int space2Xl: 16
    readonly property int space3Xl: 20
    readonly property int space4Xl: 24
    readonly property int edgeGap: desktopEdgeGap

    readonly property int typeCaption: 10
    readonly property int typeSmall: 11
    readonly property int typeBody: 12
    readonly property int typeSubtitle: 13
    readonly property int typeTitle: 14
    readonly property int typeHeading: 16
    readonly property int typeDisplay: 24
    readonly property int typeDisplayLarge: 28
    readonly property real labelTracking: 1.1
    readonly property string monospaceFamily: "monospace"

    // Unknown compositor geometry stays square. A valid desktop radius can soften clipping,
    // but app surfaces remain restrained rather than becoming rounded cards.
    readonly property int radiusSmall: Math.min(2, desktopCornerRadius)
    readonly property int radiusMedium: Math.min(4, desktopCornerRadius)
    readonly property int radiusLarge: Math.min(6, desktopCornerRadius)
    readonly property int radiusPill: 999
    readonly property int borderWidth: 1
    readonly property int focusBorderWidth: borderWidth
    readonly property int controlHeight: 36

    readonly property int motionFast: reducedMotion ? 0 : 100
    readonly property int motionNormal: reducedMotion ? 0 : 120
    readonly property int motionSlow: reducedMotion ? 0 : 160
    readonly property int animationDuration: motionNormal

    // Screenshot-derived relationship: violet-charcoal opaque bases, separated surfaces, and a
    // periwinkle structural accent. Components consume roles, never these owned literals.
    readonly property color mainSurface: themedColor("mainSurface", dark ? "#100e18" : "#f4f1fa")
    readonly property color sidebarSurface: themedColor("sidebarSurface", dark ? "#181522" : "#ebe7f3")
    readonly property color sidebarBorder: themedColor("sidebarBorder", dark ? "#4d4662" : "#b9b1c8")
    readonly property color panelSurface: themedColor("panelSurface", dark ? "#14111d" : "#fbf9fd")

    readonly property color windowBackground: themedColor("windowBackground", mainSurface)
    readonly property color surface: themedColor("surface", panelSurface)
    readonly property color surfaceRaised: themedColor("surfaceRaised", sidebarSurface)
    readonly property color assistantBubble: themedColor("assistantBubble", panelSurface)
    readonly property color userBubble: themedColor("userBubble", dark ? "#211b38" : "#e5def5")
    readonly property color foreground: themedColor("foreground", dark ? "#ded9eb" : "#272330")
    readonly property color heading: themedColor("heading", dark ? "#f8f4ff" : "#17131f")
    readonly property color muted: themedColor("muted", dark ? "#958da6" : "#6c6578")
    readonly property color border: themedColor("border", sidebarBorder)
    readonly property color frameBorder: themedColor("frameBorder", dark ? "#756b91" : "#8f85a3")
    readonly property color accent: themedColor("accent", dark ? "#afa2ee" : "#5f529b")
    readonly property color accentForeground: themedColor("accentForeground", dark ? "#c8bfff" : "#504584")
    readonly property color link: themedColor("link", accentForeground)
    readonly property color focusRing: themedColor("focusRing", accent)
    readonly property color userBorder: themedColor("userBorder", accent)
    readonly property color assistantBorder: themedColor("assistantBorder", border)

    readonly property color transparent: "transparent"
    readonly property color controlSurface: themedColor("controlSurface", surfaceRaised)
    readonly property color controlHover: themedColor("controlHover", dark ? "#211d2c" : "#e3deed")
    readonly property color controlPressed: themedColor("controlPressed", dark ? "#2b2539" : "#d9d2e6")
    readonly property color controlActive: themedColor("controlActive", userBubble)
    readonly property color controlSelected: themedColor("controlSelected", selection)
    readonly property color controlBorder: themedColor("controlBorder", border)
    readonly property color controlActiveBorder: themedColor("controlActiveBorder", accent)
    readonly property color controlSelectedBorder: themedColor("controlSelectedBorder", accent)
    readonly property color disabledSurface: themedColor("disabledSurface", dark ? "#1c1924" : "#e5e1eb")
    readonly property color disabledForeground: themedColor("disabledForeground", muted)
    readonly property color primaryButtonBackground: themedColor("primaryButtonBackground", accent)
    readonly property color primaryButtonHover: themedColor("primaryButtonHover", dark ? "#c2b8f7" : "#504584")
    readonly property color primaryButtonPressed: themedColor("primaryButtonPressed", dark ? "#9386d3" : "#443972")
    readonly property color primaryButtonForeground: themedColor("primaryButtonForeground", dark ? "#100e18" : "#ffffff")
    readonly property color primaryButtonHoverForeground: themedColor("primaryButtonHoverForeground", dark ? "#100e18" : "#ffffff")
    readonly property color primaryButtonPressedForeground: themedColor("primaryButtonPressedForeground", dark ? "#100e18" : "#ffffff")
    readonly property color destructiveButtonBackground: themedColor("destructiveButtonBackground", destructive)
    readonly property color destructiveButtonHover: themedColor("destructiveButtonHover", dark ? "#e39aa1" : "#8f3540")
    readonly property color destructiveButtonPressed: themedColor("destructiveButtonPressed", dark ? "#bd6670" : "#762b35")
    readonly property color destructiveButtonForeground: themedColor("destructiveButtonForeground", dark ? "#100e18" : "#ffffff")
    readonly property color destructiveButtonHoverForeground: themedColor("destructiveButtonHoverForeground", dark ? "#100e18" : "#ffffff")
    readonly property color destructiveButtonPressedForeground: themedColor("destructiveButtonPressedForeground", dark ? "#100e18" : "#ffffff")
    readonly property color warningButtonBackground: themedColor("warningButtonBackground", warning)
    readonly property color warningButtonHover: themedColor("warningButtonHover", dark ? "#dfc28c" : "#735300")
    readonly property color warningButtonPressed: themedColor("warningButtonPressed", dark ? "#b8965b" : "#5d4300")
    readonly property color warningButtonForeground: themedColor("warningButtonForeground", dark ? "#100e18" : "#ffffff")
    readonly property color buttonForeground: themedColor("buttonForeground", primaryButtonForeground)

    function filledButtonBackground(variant, state) {
        if (variant === "destructive") return state === "pressed" ? destructiveButtonPressed : state === "hovered" ? destructiveButtonHover : destructiveButtonBackground
        if (variant === "warning") return state === "pressed" ? warningButtonPressed : state === "hovered" ? warningButtonHover : warningButtonBackground
        return state === "pressed" ? primaryButtonPressed : state === "hovered" ? primaryButtonHover : primaryButtonBackground
    }

    function filledButtonForeground(variant, state) {
        if (variant === "destructive") return state === "pressed" ? destructiveButtonPressedForeground : state === "hovered" ? destructiveButtonHoverForeground : destructiveButtonForeground
        if (variant === "warning") return warningButtonForeground
        return state === "pressed" ? primaryButtonPressedForeground : state === "hovered" ? primaryButtonHoverForeground : primaryButtonForeground
    }

    function interactiveFill(selected, hovered, pressed) {
        if (pressed) return controlPressed
        if (hovered) return controlHover
        if (selected) return controlSelected
        return transparent
    }

    function interactiveBorder(selected, focused) {
        if (focused) return focusRing
        if (selected) return controlSelectedBorder
        return transparent
    }

    readonly property color composerSurface: themedColor("composerSurface", surface)
    readonly property color composerBorder: themedColor("composerBorder", frameBorder)

    readonly property color destructive: themedColor("destructive", dark ? "#d7828a" : "#a6434e")
    readonly property color warning: themedColor("warning", dark ? "#d1ad75" : "#8a6500")
    readonly property color urgentBackground: themedColor("urgentBackground", dark ? "#30191d" : "#f2dddf")
    readonly property color urgentBorder: themedColor("urgentBorder", destructive)
    readonly property color urgentForeground: themedColor("urgentForeground", dark ? "#efb2b8" : "#762b35")
    readonly property color selection: themedColor("selection", dark ? "#312853" : "#ddd5f2")
    readonly property color selectionForeground: themedColor("selectionForeground", dark ? "#f3efff" : "#29213f")
    readonly property color searchHighlight: themedColor("searchHighlight", dark ? "#4a3d25" : "#eee0ad")

    readonly property color codeBackground: themedColor("codeBackground", dark ? "#0b0911" : "#17131f")
    readonly property color codeForeground: themedColor("codeForeground", dark ? "#e6e0f2" : "#f8f4ff")
    readonly property color codeBorder: themedColor("codeBorder", dark ? "#514966" : "#40384f")
    readonly property color quoteBorder: themedColor("quoteBorder", frameBorder)
    readonly property color tableBorder: themedColor("tableBorder", border)
    readonly property color thinkingForeground: themedColor("thinkingForeground", accentForeground)
    readonly property color thinkingBackground: themedColor("thinkingBackground", dark ? "#201a36" : "#e9e3f7")
    readonly property color thinkingBorder: themedColor("thinkingBorder", dark ? "#665a9a" : "#a99fd0")
    readonly property color dialogOverlay: themedColor("dialogOverlay", dark ? "#b30b0911" : "#8c312b3d")

    // Syntax tokens sit on the code background, which is dark in both schemes, so the two
    // palettes differ only in contrast against the slightly different code surfaces.
    readonly property color syntaxKeyword: themedColor("syntaxKeyword", dark ? "#c4b5fd" : "#d8b4fe")
    readonly property color syntaxString: themedColor("syntaxString", dark ? "#f0b6cf" : "#f3c4d8")
    readonly property color syntaxComment: themedColor("syntaxComment", dark ? "#94a3b8" : "#a1a1aa")
    readonly property color syntaxNumber: themedColor("syntaxNumber", dark ? "#fdba74" : "#fed7aa")
    readonly property color syntaxConstant: themedColor("syntaxConstant", dark ? "#fda4af" : "#fecdd3")
    readonly property color syntaxType: themedColor("syntaxType", dark ? "#67e8f9" : "#a5f3fc")
    readonly property color syntaxFunction: themedColor("syntaxFunction", dark ? "#afa2ee" : "#c8bfff")
    readonly property color syntaxAttribute: themedColor("syntaxAttribute", dark ? "#fde68a" : "#fef08a")
    readonly property color syntaxTag: themedColor("syntaxTag", dark ? "#f9a8d4" : "#fbcfe8")
    readonly property color syntaxVariable: themedColor("syntaxVariable", dark ? "#fca5a5" : "#fecaca")
    readonly property color syntaxOperator: themedColor("syntaxOperator", dark ? "#cbd5e1" : "#e2e8f0")
    readonly property color syntaxPunctuation: themedColor("syntaxPunctuation", dark ? "#94a3b8" : "#cbd5e1")
    readonly property color diffAdded: themedColor("diffAdded", dark ? "#052e16" : "#dcfce7")
    readonly property color diffRemoved: themedColor("diffRemoved", dark ? "#450a0a" : "#fee2e2")
    readonly property color diffAddedForeground: themedColor("diffAddedForeground", dark ? "#86efac" : "#166534")
    readonly property color diffRemovedForeground: themedColor("diffRemovedForeground", dark ? "#fca5a5" : "#991b1b")
    readonly property color diffHunk: themedColor("diffHunk", dark ? "#312853" : "#ddd5f2")

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

    readonly property color success: themedColor("success", dark ? "#86d6a3" : "#23633b")
    readonly property color readyBackground: themedColor("readyBackground", dark ? "#12281a" : "#e0f2e5")
    readonly property color readyBorder: themedColor("readyBorder", dark ? "#34734b" : "#83b993")
    readonly property color readyForeground: themedColor("readyForeground", success)
    readonly property color runningBackground: themedColor("runningBackground", dark ? "#271f45" : "#e5def5")
    readonly property color runningBorder: themedColor("runningBorder", accent)
    readonly property color runningForeground: themedColor("runningForeground", accentForeground)
    readonly property color toolBackground: themedColor("toolBackground", dark ? "#422006" : "#fef3c7")
    readonly property color toolBorder: themedColor("toolBorder", dark ? "#92400e" : "#fcd34d")
    readonly property color toolForeground: themedColor("toolForeground", dark ? "#fcd34d" : "#92400e")
    readonly property color errorBackground: themedColor("errorBackground", dark ? "#450a0a" : "#fee2e2")
    readonly property color errorBorder: themedColor("errorBorder", dark ? "#991b1b" : "#fca5a5")
    readonly property color errorForeground: themedColor("errorForeground", dark ? "#fca5a5" : "#991b1b")
    readonly property color neutralBackground: themedColor("neutralBackground", dark ? "#211d2c" : "#e6e1ed")
    readonly property color neutralBorder: themedColor("neutralBorder", border)
    readonly property color neutralForeground: themedColor("neutralForeground", foreground)
    readonly property color errorPanelBackground: themedColor("errorPanelBackground", dark ? "#4c0519" : "#fff1f2")
    readonly property color errorPanelBorder: themedColor("errorPanelBorder", dark ? "#9f1239" : "#fecdd3")
    readonly property color errorPanelForeground: themedColor("errorPanelForeground", dark ? "#fda4af" : "#9f1239")
    readonly property color infoPanelBackground: themedColor("infoPanelBackground", dark ? "#271f45" : "#e9e3f7")
    readonly property color infoPanelBorder: themedColor("infoPanelBorder", accent)
    readonly property color infoPanelForeground: themedColor("infoPanelForeground", accentForeground)
    readonly property color warningPanelBackground: themedColor("warningPanelBackground", dark ? "#422006" : "#fef3c7")
    readonly property color warningPanelBorder: themedColor("warningPanelBorder", dark ? "#92400e" : "#fcd34d")
    readonly property color warningPanelForeground: themedColor("warningPanelForeground", dark ? "#fde68a" : "#92400e")

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
