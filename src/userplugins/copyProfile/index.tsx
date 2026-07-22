/*
 * Vault, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { fetchUserProfile } from "@utils/discord";
import definePlugin from "@utils/types";
import type { User } from "@vencord/discord-types";
import { Alerts, Menu, RestAPI, Toasts, UserProfileStore } from "@webpack/common";

interface UserContextProps {
    user?: User;
}

function VaultIcon(props: any) {
    return (
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <circle cx="12" cy="12" r="4.5" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <line x1="12" y1="3.2" x2="12" y2="7.5" />
            <line x1="12" y1="16.5" x2="12" y2="20.8" />
            <line x1="3.2" y1="12" x2="7.5" y2="12" />
            <line x1="16.5" y1="12" x2="20.8" y2="12" />
        </svg>
    );
}

function cdn(kind: "avatars" | "banners", id: string, hash: string) {
    const ext = hash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/${kind}/${id}/${hash}.${ext}?size=2048`;
}

async function toDataUri(url: string): Promise<string> {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
    });
}

async function patch(url: string, body: Record<string, any>): Promise<boolean> {
    if (!body || !Object.keys(body).length) return false;
    try {
        await RestAPI.patch({ url, body } as any);
        return true;
    } catch (e) {
        console.error("[CopyProfile]", url, e);
        return false;
    }
}

async function cloneProfile(user: User) {
    try {
        await fetchUserProfile(user.id);
        const profile: any = UserProfileStore.getUserProfile(user.id) ?? {};
        const u: any = user;

        // --- avatar / banner image (account-level) ---
        const me: Record<string, any> = {};
        try {
            if (user.avatar) me.avatar = await toDataUri(cdn("avatars", user.id, user.avatar));
            if (profile.banner) me.banner = await toDataUri(cdn("banners", user.id, profile.banner));
        } catch { /* image fetch failed (e.g. banner needs Nitro) */ }
        await patch("/users/@me", me);

        // --- bio / pronouns / banner color (profile-level) ---
        const prof: Record<string, any> = {};
        if (profile.bio) prof.bio = profile.bio;
        if (profile.pronouns) prof.pronouns = profile.pronouns;
        // accent color = the solid colour shown as the banner when there's no banner image
        const accent = profile.accentColor ?? u.accentColor ?? profile.bannerColor;
        if (accent != null) prof.accent_color = accent;
        await patch("/users/@me/profile", prof);

        // --- profile theme colours (gradient) — attempted whether or not you have Nitro ---
        const themeColors = profile.themeColors ?? profile.theme_colors;
        const themeApplied = Array.isArray(themeColors) && themeColors.length
            ? await patch("/users/@me/profile", { theme_colors: themeColors })
            : false;

        showNotification({
            title: "Copy Profile",
            body: `Cloned ${user.username}'s profile onto yours.` + (
                (Array.isArray(themeColors) && themeColors.length && !themeApplied)
                    ? " (profile theme needs Nitro on your account)"
                    : ""
            )
        });
    } catch (e) {
        console.error("[CopyProfile]", e);
        Toasts.show({
            message: "Failed to clone profile.",
            type: Toasts.Type.FAILURE,
            id: Toasts.genId(),
            options: { position: Toasts.Position.BOTTOM }
        });
    }
}

const patchUserContext: NavContextMenuPatchCallback = (children, { user }: UserContextProps) => {
    if (!user) return;

    children.push(
        <Menu.MenuItem
            id="vault-copy-profile"
            label="Clone Profile to Me"
            icon={VaultIcon}
            action={() => Alerts.show({
                title: "Clone Profile",
                body: `This overwrites YOUR avatar, banner, bio and pronouns with ${user.username}'s. This changes your own account. Continue?`,
                confirmText: "Clone",
                cancelText: "Cancel",
                onConfirm: () => cloneProfile(user)
            })}
        />
    );
};

export default definePlugin({
    name: "CopyProfile",
    description: "Adds a 'Clone Profile to Me' option to the user menu that copies someone's avatar, banner, bio and pronouns onto your own account.",
    authors: [{ name: "eqen", id: 1483151471183921346n }],
    enabledByDefault: false,
    tags: ["Utility", "Customisation"],
    contextMenus: {
        "user-context": patchUserContext
    }
});