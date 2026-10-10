export async function fetchNightcordBadges() {
    try {
        const r = await fetch("https://api.nightcord.st/badges");
        return r.ok ? await r.json() : {};
    } catch {
        return {};
    }
}