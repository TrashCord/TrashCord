/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

// Attachment bytes are fetched lazily (only on Render) and cached by id, so
// scrollback stays inert and re-rendering the same artifact is free. The CDN
// grants CORS to the Discord origin, so a plain renderer fetch is sufficient.
const htmlCache = new Map<string, string>();

export function dropCached(id: string) {
    htmlCache.delete(id);
}

export interface ArtifactFetch {
    loading: boolean;
    html?: string;
    error?: string;
}

export function useArtifactHtml(id: string, url: string, enabled: boolean): ArtifactFetch {
    const [state, setState] = useState<ArtifactFetch>(() =>
        htmlCache.has(id) ? { loading: false, html: htmlCache.get(id) } : { loading: false });

    useEffect(() => {
        if (!enabled || state.html || state.loading || state.error) return;

        let cancelled = false;
        setState({ loading: true });

        fetch(url)
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.text();
            })
            .then(text => {
                if (cancelled) return;
                htmlCache.set(id, text);
                setState({ loading: false, html: text });
            })
            .catch(e => {
                if (cancelled) return;
                setState({ loading: false, error: String(e?.message ?? e) });
            });

        return () => { cancelled = true; };
    }, [enabled, id, url]);

    return state;
}
