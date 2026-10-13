import { React, useState, useEffect, SelectedChannelStore } from "@webpack/common";
import { getCurrentId, isLocked } from "./storage";
import { actUnlock, actChange, actRemove } from "./modals";
import { settings } from "./settings";
import { getBackgroundFor } from "./background";

function backgroundSizeCss(mode: string): string {
    switch (mode) {
        case "contain": return "contain";
        case "stretch": return "100% 100%";
        case "tile": return "auto";
        case "center": return "auto";
        case "cover":
        default: return "cover";
    }
}

export const Overlay: React.FC = () => {
    const [updateKey, setUpdateKey] = useState(0);
    const { backgroundSize, enableBlur, blurStrength } = settings.use([
        "backgroundSize", "enableBlur", "blurStrength"
    ]);

    useEffect(() => {
        const handler = () => setUpdateKey(k => k + 1);
        document.addEventListener("chatlock-refresh", handler);
        const unsub = SelectedChannelStore.addChangeListener(handler);
        return () => {
            document.removeEventListener("chatlock-refresh", handler);
            unsub?.();
        };
    }, []);

    const id = getCurrentId();
    if (!id || !isLocked(id)) return null;

    const backgroundImage = getBackgroundFor(id);
    const hasCustomBg = !!backgroundImage;
    const blurCss = enableBlur ? `blur(${blurStrength}px)` : undefined;

    // Background layer: either the user's image (blurred/sized per settings)
    // or the default flat dark backdrop that blurs the chat behind it.
    const backgroundLayerStyle: React.CSSProperties = hasCustomBg
        ? {
            position: "absolute",
            inset: 0,
            backgroundImage: `url("${backgroundImage}")`,
            backgroundSize: backgroundSizeCss(backgroundSize),
            backgroundRepeat: backgroundSize === "tile" ? "repeat" : "no-repeat",
            backgroundPosition: "center",
            filter: blurCss,
            // Slightly overscale when blurring so the blur radius doesn't
            // pull in transparent edges from outside the layer's bounds.
            transform: enableBlur ? "scale(1.12)" : undefined,
        }
        : {
            position: "absolute",
            inset: 0,
            background: "rgba(0, 0, 0, 0.85)",
            backdropFilter: blurCss,
            WebkitBackdropFilter: blurCss,
        };

    return (
        <div id="chatlock-overlay" style={{
            position: "absolute",
            inset: -200,
            zIndex: 4,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            overflow: "hidden",
            borderRadius: 0,
            pointerEvents: "auto",
            color: "var(--text-normal)",
            transition: "opacity 0.2s",
            willChange: "transform",
            boxShadow: "0 0 40px rgba(0, 0, 0, 0.6)",
        }}>
            <div style={backgroundLayerStyle} />
            {hasCustomBg && (
                <div style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(0, 0, 0, 0.35)",
                }} />
            )}
            <div style={{
                position: "relative",
                zIndex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                background: "rgba(24, 24, 24, 0.93)",
                padding: "40px 48px",
                borderRadius: "16px",
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
                maxWidth: "460px",
                width: "90%",
                pointerEvents: "auto",
                opacity: 0.95,
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
                    <svg width="72" height="72" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path fill="currentColor" fillRule="evenodd" d="M6 9h1V6a5 5 0 0 1 10 0v3h1a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3Zm9-3v3H9V6a3 3 0 1 1 6 0Zm-1 8a2 2 0 0 1-1 1.73V18a1 1 0 1 1-2 0v-2.27A2 2 0 1 1 14 14Z" clipRule="evenodd"/>
                    </svg>
                </div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-muted)", textAlign: "center" }}>This chat is locked</div>
                <div style={{ fontSize: "14px", color: "var(--text-muted)", textAlign: "center" }}>Enter the password to unlock and view messages.</div>
                <button style={{ marginTop: "4px", padding: "12px 28px", background: "#5865F2", color: "#fff", border: "none", borderRadius: "8px", fontSize: "16px", fontWeight: 600, fontFamily: '"gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif', cursor: "pointer", transition: "background 0.15s, transform 0.1s", pointerEvents: "auto", userSelect: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.2)", width: "100%" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#4752C4"}
                    onMouseLeave={e => e.currentTarget.style.background = "#5865F2"}
                    onMouseDown={e => e.currentTarget.style.transform = "scale(0.96)"}
                    onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                    onClick={() => { const id = getCurrentId(); if (id && isLocked(id)) actUnlock(); }}>
                    Unlock Chat
                </button>
                <button style={{ marginTop: "4px", padding: "10px 24px", background: "var(--background-secondary)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 500, fontFamily: '"gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif', cursor: "pointer", transition: "background 0.15s, transform 0.1s", pointerEvents: "auto", userSelect: "none", width: "100%" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--background-modifier-hover)"}
                    onMouseLeave={e => e.currentTarget.style.background = "var(--background-secondary)"}
                    onMouseDown={e => e.currentTarget.style.transform = "scale(0.96)"}
                    onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                    onClick={() => { const id = getCurrentId(); if (id && isLocked(id)) actChange(); }}>
                    Change Password
                </button>
                <button style={{ marginTop: "4px", padding: "10px 24px", background: "var(--button-danger-background)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 500, fontFamily: '"gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif', cursor: "pointer", transition: "background 0.15s, transform 0.1s", pointerEvents: "auto", userSelect: "none", width: "100%" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--button-danger-background-hover)"}
                    onMouseLeave={e => e.currentTarget.style.background = "var(--button-danger-background)"}
                    onMouseDown={e => e.currentTarget.style.transform = "scale(0.96)"}
                    onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                    onClick={() => { const id = getCurrentId(); if (id && isLocked(id)) actRemove(); }}>
                    Remove Lock
                </button>
            </div>
        </div>
    );
};
