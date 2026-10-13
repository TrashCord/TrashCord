/*
 * Profile Presets - Equicord & Vencord Plugin
 * Full feature preset manager with Disk Storage, Tag/Clan, Display Name, Bio, Pronouns, Custom Status,
 * Connected Accounts Visibility, Banner, Avatar, Themes, Decorations, Nameplate, Effects, Frames, Display Name Styles.
 */

import * as DataStore from "@api/DataStore";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { getUserSettingLazy } from "@api/UserSettings";
import definePlugin, { PluginNative } from "@utils/types";
import { findComponentByCodeLazy, findStoreLazy } from "@webpack";
import { FluxDispatcher, Menu, Popout, RestAPI, showToast, Toasts, useRef, useState, UserStore } from "@webpack/common";

const STORE_KEY = "ProfilePresets_v2";
const MODAL_ID = "vc-profile-presets-modal";
const PREVIEW_MODAL_ID = "vc-profile-presets-preview-modal";

const CustomStatusSettings = getUserSettingLazy("status", "customStatus");

// @ts-ignore
const Native = (VencordNative?.pluginHelpers?.ProfilePresets ?? VencordNative?.pluginHelpers?.profilePresets) as PluginNative<typeof import("./native")> | undefined;



const ICONS = {
    studio: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/></svg>`,
    apply: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    preview: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    edit: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    rename: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`,
    export: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    import: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    refresh: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.13 15.57a10 10 0 1 0 0-7.14l-1.63-1.63"/><path d="M2.5 22v-6h6"/></svg>`,
    delete: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
    close: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    drawer: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>`
};

function UserAreaPresetIcon({ className }: { className?: string }) {
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
        </svg>
    );
}

function UserAreaPresetQuickButton(props: UserAreaRenderProps) {
    const [presets, setPresetsState] = useState<ProfilePreset[]>([]);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const loadPresets = () => {
        getPresets().then(list => {
            const fullOnly = list.filter(p => (p.presetType || "full") === "full");
            setPresetsState(fullOnly);
        });
    };

    return (
        <Popout
            position="top"
            align="left"
            targetElementRef={containerRef}
            renderPopout={({ closePopout }) => (
                <Menu.Menu navId="vc-profile-presets-quick-menu" onClose={closePopout}>
                    <Menu.MenuGroup label="Full Profile Presets">
                        {presets.length === 0 ? (
                            <Menu.MenuItem id="vc-preset-none" label="No full profile presets saved" disabled />
                        ) : (
                            presets.map(p => (
                                <Menu.MenuItem
                                    key={p.id}
                                    id={`vc-preset-${p.id}`}
                                    label={p.name}
                                    action={async () => {
                                        closePopout();
                                        toast(`Applying "${p.name}"…`, Toasts.Type.MESSAGE);
                                        const failures = await applyPreset(p);
                                        if (failures.length === 0) {
                                            toast(`Applied "${p.name}"!`, Toasts.Type.SUCCESS);
                                        } else {
                                            toast(`Applied with notes: ${failures.join(", ")}`, Toasts.Type.FAILURE);
                                        }
                                    }}
                                />
                            ))
                        )}
                    </Menu.MenuGroup>
                    <Menu.MenuSeparator />
                    <Menu.MenuItem
                        id="vc-preset-open-studio"
                        label="Open Studio / Manager"
                        action={() => {
                            closePopout();
                            void openModal();
                        }}
                    />
                </Menu.Menu>
            )}
        >
            {popoutProps => (
                <div ref={containerRef} style={{ display: "inline-flex" }}>
                    <UserAreaButton
                        tooltipText="Quick Profile Presets (Right-click: Open Studio)"
                        icon={<UserAreaPresetIcon />}
                        plated={props?.nameplate != null}
                        onClick={e => {
                            loadPresets();
                            popoutProps.onClick(e);
                        }}
                        onContextMenu={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            void openModal();
                        }}
                    />
                </div>
            )}
        </Popout>
    );
}

interface UserConnectionSetting {
    type: string;
    id: string;
    name: string;
    visibility: number;
    showActivity: boolean;
}

interface ProfilePreset {
    id: string;
    name: string;
    createdAt: number;
    presetType?: "full" | "profile" | "connections";

    globalName: string | null;
    bio: string | null;
    pronouns: string | null;
    primaryGuildId: string | null;

    avatar: string | null;
    banner: string | null;

    accentColor: number | null;
    themeColors: [number, number] | null;

    avatarDecorationSkuId: string | null;
    nameplateSkuId: string | null;

    displayNameFontId: number | null;
    displayNameEffectId: number | null;
    displayNameColors: number[] | null;

    profileEffectId: string | null;
    profileFrameSkuId: string | null;

    customStatus: Record<string, any> | null;
    applicationUserData: Record<string, any> | null;

    userConnections: UserConnectionSetting[] | null;

    collectibles: Record<string, any> | null;
}

const UserProfileSettingsStore = findStoreLazy("UserProfileSettingsStore");
const UserProfileStore = findStoreLazy("UserProfileStore");
const ConnectedAccountsStore = findStoreLazy("ConnectedAccountsStore");

function renderInModalToast(targetModal: HTMLElement, message: string, type: any) {
    let toastContainer = targetModal.querySelector(".vc-preset-inmodal-toast-container") as HTMLElement;
    if (!toastContainer) {
        toastContainer = document.createElement("div");
        toastContainer.className = "vc-preset-inmodal-toast-container";
        css(toastContainer, {
            position: "absolute",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: "9999999",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            pointerEvents: "none",
            alignItems: "center"
        });
        if (targetModal.style.position !== "relative" && targetModal.style.position !== "absolute") {
            targetModal.style.position = "relative";
        }
        targetModal.append(toastContainer);
    }

    toastContainer.innerHTML = "";

    const toastPill = document.createElement("div");
    const isSuccess = type === Toasts.Type.SUCCESS;
    const isFailure = type === Toasts.Type.FAILURE;

    const borderColor = isSuccess ? "rgba(35, 165, 90, 0.5)" : (isFailure ? "rgba(242, 63, 67, 0.5)" : "rgba(88, 101, 242, 0.5)");
    const iconColor = isSuccess ? "#23a55a" : (isFailure ? "#f23f43" : "#5865f2");
    const iconSvg = isSuccess
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

    css(toastPill, {
        background: "#111214",
        color: "#ffffff",
        padding: "10px 20px",
        borderRadius: "20px",
        fontSize: "13px",
        fontWeight: "700",
        border: `1px solid ${borderColor}`,
        boxShadow: "0 10px 30px rgba(0,0,0,0.9)",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        opacity: "0",
        transform: "translateY(-12px)",
        transition: "all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)",
        pointerEvents: "auto"
    });

    toastPill.innerHTML = `${iconSvg} <span>${message}</span>`;
    toastContainer.append(toastPill);

    requestAnimationFrame(() => {
        css(toastPill, { opacity: "1", transform: "translateY(0)" });
    });

    setTimeout(() => {
        css(toastPill, { opacity: "0", transform: "translateY(-12px)" });
        setTimeout(() => toastPill.remove(), 250);
    }, 3000);
}

function toast(message: string, type = Toasts.Type.MESSAGE) {
    const activeModal = document.querySelector(`#${MODAL_ID} > div, #${PREVIEW_MODAL_ID} > div`) as HTMLElement | null;
    if (activeModal) {
        renderInModalToast(activeModal, message, type);
    } else {
        try {
            showToast(message, type);
        } catch {}
    }
}

async function getPresets(): Promise<ProfilePreset[]> {
    let localPresets: ProfilePreset[] = [];
    try {
        const value = await DataStore.get(STORE_KEY);
        if (Array.isArray(value)) localPresets = value;
    } catch (e) {
        console.warn("[ProfilePresets] DataStore get error", e);
    }

    let diskPresets: ProfilePreset[] = [];
    if (Native?.loadDiskPresets) {
        try {
            const res = await Native.loadDiskPresets();
            if (res?.success && Array.isArray(res.presets)) {
                diskPresets = res.presets;
            }
        } catch (e) {
            console.warn("[ProfilePresets] Disk presets load error", e);
        }
    }

    const presetMap = new Map<string, ProfilePreset>();

    for (const p of localPresets) {
        if (p && p.name) {
            presetMap.set(p.name.toLowerCase(), p);
        }
    }

    for (const p of diskPresets) {
        if (p && p.name) {
            const key = p.name.toLowerCase();
            const existing = presetMap.get(key);
            if (!existing || (p.createdAt && existing.createdAt && p.createdAt > existing.createdAt)) {
                presetMap.set(key, p);
            }
        }
    }

    const mergedList = Array.from(presetMap.values());
    mergedList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (mergedList.length !== localPresets.length) {
        await DataStore.set(STORE_KEY, mergedList);
    }

    return mergedList;
}

async function setPresets(presets: ProfilePreset[]) {
    const seenNames = new Set<string>();
    const uniquePresets: ProfilePreset[] = [];

    for (const p of presets) {
        if (!p || !p.name) continue;
        const key = p.name.toLowerCase();
        if (!seenNames.has(key)) {
            seenNames.add(key);
            uniquePresets.push(p);
        }
    }

    await DataStore.set(STORE_KEY, uniquePresets);

    if (Native?.syncAllToDisk) {
        Native.syncAllToDisk(uniquePresets).catch(() => {});
    }
}



function cdnUrl(type: "avatars" | "banners", userId: string, hash: string) {
    const isAnimated = hash.startsWith("a_");
    const extension = isAnimated ? "gif" : "png";
    const size = type === "avatars" ? 256 : 512;
    return `https://cdn.discordapp.com/${type}/${userId}/${hash}.${extension}?size=${size}`;
}

async function imageToDataUri(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not download image (${response.status})`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
        reader.readAsDataURL(blob);
    });
}

function normalizeImageValue(value: unknown): string | null {
    if (typeof value === "string" && value.length > 0) return value;
    if (value && typeof value === "object" && "imageUri" in value) {
        const { imageUri } = value as { imageUri: unknown };
        return typeof imageUri === "string" ? imageUri : null;
    }
    return null;
}

async function ensureValidDiscordImageDataUri(
    dataUri: string | null,
    isAnimated = false,
    maxDimension = 256
): Promise<string | null> {
    if (!dataUri || typeof dataUri !== "string" || !dataUri.startsWith("data:")) return null;

    if (isAnimated) {
        if (dataUri.startsWith("data:image/gif;base64,")) return dataUri;
        return dataUri.replace(/^data:[^;]+;/, "data:image/gif;");
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const srcWidth = img.naturalWidth || img.width || maxDimension;
                const srcHeight = img.naturalHeight || img.height || maxDimension;

                let width = srcWidth;
                let height = srcHeight;
                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    } else {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    ctx.drawImage(img, 0, 0, width, height);
                    const pngUri = canvas.toDataURL("image/png");
                    if (pngUri.startsWith("data:image/png;base64,")) {
                        resolve(pngUri);
                        return;
                    }
                }
            } catch (err) {
                console.warn("[ProfilePresets] Canvas downscale error", err);
            }
            resolve(dataUri.replace(/^data:[^;]+;/, "data:image/png;"));
        };
        img.onerror = () => {
            resolve(dataUri.replace(/^data:[^;]+;/, "data:image/png;"));
        };
        img.src = dataUri;
    });
}

function snakeOrCamel(obj: any, snake: string, camel: string) {
    return obj?.[snake] ?? obj?.[camel] ?? null;
}

function getSkuId(value: any): string | null {
    if (!value) return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        return (trimmed === "" || trimmed === "0" || trimmed === "none" || trimmed === "null" || trimmed === "undefined") ? null : trimmed;
    }
    if (typeof value === "number") return value === 0 ? null : String(value);
    const sku = value.sku_id ?? value.skuId ?? value.id ?? value.sku_ID ?? value.skuID ?? null;
    if (sku == null) return null;
    const strSku = String(sku).trim();
    return (strSku === "" || strSku === "0" || strSku === "none" || strSku === "null" || strSku === "undefined") ? null : strSku;
}

async function fetchCurrentAccount(): Promise<any> {
    try {
        const response = await RestAPI.get({ url: "/users/@me" });
        return response?.body ?? UserStore.getCurrentUser();
    } catch {
        return UserStore.getCurrentUser();
    }
}

async function fetchCurrentPublicUser(userId: string): Promise<any> {
    try {
        const response = await RestAPI.get({ url: `/users/${userId}` });
        return response?.body ?? {};
    } catch {
        return {};
    }
}

async function fetchUserConnections(): Promise<UserConnectionSetting[]> {
    let list: any[] = [];

    try {
        const storeAccounts = ConnectedAccountsStore?.getAccounts?.() ?? ConnectedAccountsStore?.accounts;
        if (Array.isArray(storeAccounts) && storeAccounts.length > 0) {
            list = storeAccounts;
        }
    } catch (err) {
        console.warn("[ProfilePresets] ConnectedAccountsStore fetch error", err);
    }

    if (!list || list.length === 0) {
        try {
            const response = await RestAPI.get({ url: "/users/@me/connections" });
            if (Array.isArray(response?.body) && response.body.length > 0) {
                list = response.body;
            }
        } catch (err) {
            console.warn("[ProfilePresets] RestAPI connections fetch error", err);
        }
    }

    if (!Array.isArray(list) || list.length === 0) return [];

    const seen = new Set<string>();
    const uniqueList: UserConnectionSetting[] = [];
    for (const c of list) {
        const key = `${c.type}:${c.id}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueList.push({
                type: String(c.type),
                id: String(c.id),
                name: String(c.name ?? ""),
                visibility: Number(c.visibility ?? 0),
                showActivity: Boolean(c.show_activity ?? c.showActivity)
            });
        }
    }
    return uniqueList;
}

function extractAvatarDecorationSkuId(pendingChanges: any, meProfile: any, fullProfile: any, account: any): string | null {
    if (pendingChanges?.pendingAvatarDecorationSkuId !== undefined) {
        return getSkuId(pendingChanges.pendingAvatarDecorationSkuId);
    }
    if (pendingChanges?.pendingAvatarDecoration !== undefined) {
        return getSkuId(pendingChanges.pendingAvatarDecoration);
    }

    const meProfileUser = meProfile?.user_profile;
    if (meProfileUser && ("avatar_decoration_sku_id" in meProfileUser || "avatar_decoration_data" in meProfileUser)) {
        return getSkuId(meProfileUser.avatar_decoration_sku_id ?? meProfileUser.avatar_decoration_data);
    }
    if (meProfile && ("avatar_decoration_sku_id" in meProfile || "avatar_decoration_data" in meProfile)) {
        return getSkuId(meProfile.avatar_decoration_sku_id ?? meProfile.avatar_decoration_data);
    }

    const fullProfileUser = fullProfile?.user_profile;
    if (fullProfileUser && ("avatar_decoration_sku_id" in fullProfileUser || "avatar_decoration_data" in fullProfileUser)) {
        return getSkuId(fullProfileUser.avatar_decoration_sku_id ?? fullProfileUser.avatar_decoration_data);
    }

    const accDecoration = snakeOrCamel(account, "avatar_decoration_data", "avatarDecorationData");
    return getSkuId(accDecoration);
}

function extractNameplateSkuId(pendingChanges: any, meProfile: any, fullProfile: any, account: any): string | null {
    if (pendingChanges?.pendingNameplateSkuId !== undefined) {
        return getSkuId(pendingChanges.pendingNameplateSkuId);
    }
    if (pendingChanges?.pendingNameplate !== undefined) {
        return getSkuId(pendingChanges.pendingNameplate);
    }

    const meProfileUser = meProfile?.user_profile;
    if (meProfileUser && ("nameplate_sku_id" in meProfileUser || "nameplate" in meProfileUser)) {
        return getSkuId(meProfileUser.nameplate_sku_id ?? meProfileUser.nameplate);
    }

    const fullProfileUser = fullProfile?.user_profile;
    if (fullProfileUser && ("nameplate_sku_id" in fullProfileUser || "nameplate" in fullProfileUser)) {
        return getSkuId(fullProfileUser.nameplate_sku_id ?? fullProfileUser.nameplate);
    }

    return getSkuId(account?.nameplate);
}

function extractProfileEffectId(pendingChanges: any, meProfile: any, fullProfile: any, account: any): string | null {
    if (pendingChanges?.pendingProfileEffectId !== undefined) {
        return getSkuId(pendingChanges.pendingProfileEffectId);
    }
    if (pendingChanges?.pendingProfileEffect !== undefined) {
        return getSkuId(pendingChanges.pendingProfileEffect);
    }

    const meProfileUser = meProfile?.user_profile;
    if (meProfileUser && ("profile_effect_id" in meProfileUser || "profile_effect" in meProfileUser)) {
        return getSkuId(meProfileUser.profile_effect_id ?? meProfileUser.profile_effect);
    }
    if (meProfile && ("profile_effect_id" in meProfile || "profile_effect" in meProfile)) {
        return getSkuId(meProfile.profile_effect_id ?? meProfile.profile_effect);
    }

    const fullProfileUser = fullProfile?.user_profile;
    if (fullProfileUser && ("profile_effect_id" in fullProfileUser || "profile_effect" in fullProfileUser)) {
        return getSkuId(fullProfileUser.profile_effect_id ?? fullProfileUser.profile_effect);
    }

    return getSkuId(account?.profile_effect);
}

function extractProfileFrameSkuId(pendingChanges: any, meProfile: any, fullProfile: any, account: any): string | null {
    if (pendingChanges?.pendingProfileFrameSkuId !== undefined) {
        return getSkuId(pendingChanges.pendingProfileFrameSkuId);
    }
    if (pendingChanges?.pendingProfileFrame !== undefined) {
        return getSkuId(pendingChanges.pendingProfileFrame);
    }

    const meProfileUser = meProfile?.user_profile;
    if (meProfileUser && ("profile_frame_sku_id" in meProfileUser || "profile_frame" in meProfileUser)) {
        return getSkuId(meProfileUser.profile_frame_sku_id ?? meProfileUser.profile_frame);
    }
    if (meProfile && ("profile_frame_sku_id" in meProfile || "profile_frame" in meProfile)) {
        return getSkuId(meProfile.profile_frame_sku_id ?? meProfile.profile_frame);
    }

    const fullProfileUser = fullProfile?.user_profile;
    if (fullProfileUser && ("profile_frame_sku_id" in fullProfileUser || "profile_frame" in fullProfileUser)) {
        return getSkuId(fullProfileUser.profile_frame_sku_id ?? fullProfileUser.profile_frame);
    }

    return getSkuId(account?.profile_frame);
}

async function capturePreset(name: string, scopeType: "full" | "profile" | "connections" = "full"): Promise<ProfilePreset> {
    const cachedUser: any = UserStore.getCurrentUser();

    if (!cachedUser)
        throw new Error("Discord has not loaded your account yet.");

    const pendingChanges = UserProfileSettingsStore?.getPendingChanges?.() ?? {};

    const [account, publicUser, fullProfile, rawConnections, meProfile] = await Promise.all([
        fetchCurrentAccount(),
        fetchCurrentPublicUser(cachedUser.id),
        RestAPI.get({
            url: `/users/${cachedUser.id}/profile`,
            query: {
                with_mutual_guilds: false,
                with_mutual_friends_count: false,
                type: "you_screen"
            }
        }).then(r => r?.body ?? {}).catch(() => ({})),
        fetchUserConnections(),
        RestAPI.get({ url: "/users/@me/profile" }).then(r => r?.body ?? {}).catch(() => ({}))
    ]);

    let userConnections = rawConnections;
    const includeProfile = scopeType === "full" || scopeType === "profile";
    const includeConnections = scopeType === "full" || scopeType === "connections";

    if (includeConnections && (!userConnections || userConnections.length === 0)) {
        const profileAccounts = meProfile?.connected_accounts ?? fullProfile?.connected_accounts ?? [];
        if (Array.isArray(profileAccounts) && profileAccounts.length > 0) {
            const seen = new Set<string>();
            userConnections = [];
            for (const c of profileAccounts) {
                const key = `${c.type}:${c.id}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    userConnections.push({
                        type: String(c.type),
                        id: String(c.id),
                        name: String(c.name ?? ""),
                        visibility: Number(c.visibility ?? 0),
                        showActivity: Boolean(c.show_activity ?? c.showActivity)
                    });
                }
            }
        }
    }

    const profileUser = fullProfile?.user ?? publicUser ?? account ?? cachedUser;
    const profile = fullProfile?.user_profile ?? {};

    const avatarHash = profileUser?.avatar ?? publicUser?.avatar ?? account?.avatar ?? cachedUser?.avatar ?? null;
    const bannerHash = profileUser?.banner ?? publicUser?.banner ?? account?.banner ?? profile?.banner ?? cachedUser?.banner ?? null;

    let rawAvatar = pendingChanges.pendingAvatar ? normalizeImageValue(pendingChanges.pendingAvatar) : null;
    let rawBanner = pendingChanges.pendingBanner ? normalizeImageValue(pendingChanges.pendingBanner) : null;

    if (!rawAvatar && avatarHash) {
        rawAvatar = await imageToDataUri(cdnUrl("avatars", cachedUser.id, avatarHash)).catch(() => null);
    }

    if (!rawBanner && bannerHash) {
        rawBanner = await imageToDataUri(cdnUrl("banners", cachedUser.id, bannerHash)).catch(() => null);
    }

    const [avatar, banner] = await Promise.all([
        ensureValidDiscordImageDataUri(rawAvatar, avatarHash?.startsWith("a_"), 256),
        ensureValidDiscordImageDataUri(rawBanner, bannerHash?.startsWith("a_"), 512)
    ]);

    const globalName =
        (typeof pendingChanges.pendingGlobalName === "string" ? pendingChanges.pendingGlobalName : null) ??
        profileUser?.global_name ?? publicUser?.global_name ?? account?.global_name ?? cachedUser?.globalName ?? cachedUser?.global_name ?? null;

    const bio =
        (typeof pendingChanges.pendingBio === "string" ? pendingChanges.pendingBio : null) ??
        profile?.bio ?? profileUser?.bio ?? account?.bio ?? publicUser?.bio ?? null;

    const pronouns =
        (typeof pendingChanges.pendingPronouns === "string" ? pendingChanges.pendingPronouns : null) ??
        profile?.pronouns ?? profileUser?.pronouns ?? account?.pronouns ?? publicUser?.pronouns ?? null;

    const primaryGuildId =
        (typeof pendingChanges.pendingPrimaryGuildId === "string" ? pendingChanges.pendingPrimaryGuildId : null) ??
        account?.primary_guild?.identity_guild_id ?? account?.primary_guild_id ?? cachedUser?.primaryGuild?.identityGuildId ?? null;

    const rawThemeColors =
        pendingChanges.pendingThemeColors ??
        meProfile?.theme_colors ??
        meProfile?.themeColors ??
        profile?.theme_colors ??
        profile?.themeColors ??
        account?.theme_colors ??
        account?.themeColors ??
        null;

    const themeColors = Array.isArray(rawThemeColors) && rawThemeColors.length >= 2 ? [Number(rawThemeColors[0]), Number(rawThemeColors[1])] as [number, number] : null;

    const rawAccentColor =
        pendingChanges.pendingAccentColor ??
        pendingChanges.accentColor ??
        meProfile?.accent_color ??
        meProfile?.accentColor ??
        profile?.accent_color ??
        profileUser?.accent_color ??
        account?.accent_color ??
        cachedUser?.accentColor ??
        null;

    const accentColor = typeof rawAccentColor === "number" ? rawAccentColor : null;

    const collectibles =
        snakeOrCamel(account, "collectibles", "collectibles") ??
        snakeOrCamel(cachedUser, "collectibles", "collectibles") ??
        snakeOrCamel(profileUser, "collectibles", "collectibles") ??
        fullProfile?.user_profile?.collectibles ??
        fullProfile?.collectibles ??
        null;

    const avatarDecorationSkuId = extractAvatarDecorationSkuId(pendingChanges, meProfile, fullProfile, account);
    const nameplateSkuId = extractNameplateSkuId(pendingChanges, meProfile, fullProfile, account);
    const profileEffectId = extractProfileEffectId(pendingChanges, meProfile, fullProfile, account);
    const profileFrameSkuId = extractProfileFrameSkuId(pendingChanges, meProfile, fullProfile, account);

    const displayNameStyles = pendingChanges.pendingDisplayNameStyles ?? snakeOrCamel(account, "display_name_styles", "displayNameStyles") ?? null;

    const statusSetting = CustomStatusSettings?.getSetting?.();
    const customStatus = statusSetting
        ? {
            text: statusSetting.text ?? "",
            emojiId: String(statusSetting.emojiId ?? "0"),
            emojiName: statusSetting.emojiName ?? "",
            expiresAtMs: String(statusSetting.expiresAtMs ?? "0")
        }
        : (snakeOrCamel(account, "custom_status", "customStatus") ?? null);

    const preset: ProfilePreset = {
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
        presetType: scopeType,

        globalName: includeProfile ? globalName : null,
        bio: includeProfile ? bio : null,
        pronouns: includeProfile ? pronouns : null,
        primaryGuildId: includeProfile ? primaryGuildId : null,

        avatar: includeProfile ? avatar : null,
        banner: includeProfile ? banner : null,
        accentColor: includeProfile ? accentColor : null,
        themeColors: includeProfile ? themeColors : null,

        avatarDecorationSkuId: includeProfile ? avatarDecorationSkuId : null,
        nameplateSkuId: includeProfile ? nameplateSkuId : null,
        displayNameFontId: includeProfile ? (displayNameStyles?.font_id ?? displayNameStyles?.fontId ?? null) : null,
        displayNameEffectId: includeProfile ? (displayNameStyles?.effect_id ?? displayNameStyles?.effectId ?? null) : null,
        displayNameColors: includeProfile ? (Array.isArray(displayNameStyles?.colors) ? displayNameStyles.colors.map(Number) : null) : null,
        profileEffectId: includeProfile ? profileEffectId : null,
        profileFrameSkuId: includeProfile ? profileFrameSkuId : null,

        customStatus: includeProfile ? customStatus : null,
        applicationUserData: null,
        userConnections: includeConnections && userConnections.length > 0 ? userConnections : null,
        collectibles: includeProfile && collectibles ? structuredClone(collectibles) : null
    };

    if (Native?.savePresetFiles) {
        try {
            await Native.savePresetFiles(preset);
        } catch (err) {
            console.warn("[ProfilePresets] Disk saving failed", err);
        }
    }

    return preset;
}

async function safeAccountPatch(label: string, body: Record<string, unknown>): Promise<boolean> {
    try {
        await RestAPI.patch({ url: "/users/@me", body });
        return true;
    } catch (err: any) {
        console.warn(`[ProfilePresets] Account patch for ${label} skipped/failed`, err?.body ?? err);
        return false;
    }
}

async function safeProfilePatch(label: string, body: Record<string, unknown>): Promise<boolean> {
    try {
        await RestAPI.patch({ url: "/users/@me/profile", body });
        return true;
    } catch (err: any) {
        console.warn(`[ProfilePresets] Profile patch for ${label} skipped/failed`, err?.body ?? err);
        return false;
    }
}

async function applyPreset(preset: ProfilePreset): Promise<string[]> {
    const failures: string[] = [];
    const type = preset.presetType ?? "full";

    const doProfile = type === "full" || type === "profile";
    const doConnections = type === "full" || type === "connections";

    // 1. Custom Status via UserSettings store
    if (doProfile && preset.customStatus !== undefined) {
        try {
            if (CustomStatusSettings?.updateSetting) {
                CustomStatusSettings.updateSetting({
                    text: preset.customStatus?.text ?? "",
                    expiresAtMs: String(preset.customStatus?.expiresAtMs ?? preset.customStatus?.expires_at_ms ?? "0"),
                    emojiId: String(preset.customStatus?.emojiId ?? preset.customStatus?.emoji_id ?? "0"),
                    emojiName: preset.customStatus?.emojiName ?? preset.customStatus?.emoji_name ?? ""
                });
            }
        } catch (error) {
            console.warn("[ProfilePresets] Custom status skipped", error);
        }
    }

    // 2. Avatar
    if (doProfile) {
        if (preset.avatar && preset.avatar.startsWith("data:")) {
            const isGif = preset.avatar.includes("image/gif");
            const validAvatar = await ensureValidDiscordImageDataUri(preset.avatar, isGif, 256);
            if (validAvatar) {
                const ok = await safeAccountPatch("avatar", { avatar: validAvatar });
                if (!ok && isGif) {
                    const staticPng = await ensureValidDiscordImageDataUri(preset.avatar, false, 256);
                    if (staticPng) {
                        const retryOk = await safeAccountPatch("avatar", { avatar: staticPng });
                        if (!retryOk) failures.push("avatar");
                    } else {
                        failures.push("avatar");
                    }
                } else if (!ok) {
                    failures.push("avatar");
                }
            }
        } else if (preset.avatar === null && type === "full") {
            await safeAccountPatch("clear avatar", { avatar: null });
        }
    }

    // 3. Banner
    if (doProfile) {
        if (preset.banner && preset.banner.startsWith("data:")) {
            const isGif = preset.banner.includes("image/gif");
            const validBanner = await ensureValidDiscordImageDataUri(preset.banner, isGif, 512);
            if (validBanner) {
                const ok = await safeProfilePatch("banner", { banner: validBanner });
                if (!ok) {
                    await safeAccountPatch("banner", { banner: validBanner });
                }
            }
        } else if (preset.banner === null && type === "full") {
            await safeProfilePatch("clear banner", { banner: null });
        }
    }

    // 4. Global Name (Display Name)
    if (doProfile && preset.globalName !== undefined && preset.globalName !== null) {
        await safeAccountPatch("display name", { global_name: preset.globalName });
    }

    // 5. Bio
    if (doProfile && preset.bio !== undefined && preset.bio !== null) {
        await safeProfilePatch("bio", { bio: preset.bio });
    }

    // 6. Pronouns
    if (doProfile && preset.pronouns !== undefined && preset.pronouns !== null) {
        await safeProfilePatch("pronouns", { pronouns: preset.pronouns });
    }

    // 7. Clan Tag / Primary Guild Tag
    if (doProfile && preset.primaryGuildId !== undefined) {
        await safeAccountPatch("primary guild", { primary_guild_id: preset.primaryGuildId });
    }

    // 8. Display Name Styles (Font, Effect, Colors)
    if (doProfile) {
        const hasFont = typeof preset.displayNameFontId === "number" && preset.displayNameFontId !== 0;
        const hasEffect = typeof preset.displayNameEffectId === "number" && preset.displayNameEffectId !== 0;
        const hasColors = Array.isArray(preset.displayNameColors) && preset.displayNameColors.length > 0;
        const hasNameStyle = hasFont || hasEffect || hasColors;

        await safeAccountPatch("display name styles", {
            display_name_font_id: hasFont ? preset.displayNameFontId : null,
            display_name_effect_id: hasEffect ? preset.displayNameEffectId : null,
            display_name_colors: hasColors ? preset.displayNameColors : null,
            display_name_styles: hasNameStyle ? {
                font_id: hasFont ? preset.displayNameFontId : null,
                effect_id: hasEffect ? preset.displayNameEffectId : null,
                colors: hasColors ? preset.displayNameColors : null
            } : null
        });
    }

    // 9. Connected Accounts Visibility
    if (doConnections && Array.isArray(preset.userConnections) && preset.userConnections.length > 0) {
        const seenConns = new Set<string>();
        for (const conn of preset.userConnections) {
            const key = `${conn.type}:${conn.id}`;
            if (seenConns.has(key)) continue;
            seenConns.add(key);
            try {
                await RestAPI.patch({
                    url: `/users/@me/connections/${conn.type}/${conn.id}`,
                    body: {
                        visibility: Number(conn.visibility),
                        show_activity: Boolean(conn.showActivity)
                    }
                });
            } catch (err) {
                console.warn(`[ProfilePresets] Could not update connection ${conn.type}/${conn.id}`, err);
            }
        }
        if (FluxDispatcher) {
            FluxDispatcher.dispatch({ type: "USER_CONNECTIONS_UPDATE" });
        }
    }

    // 10. Theme / Accent Colors
    if (doProfile) {
        if (preset.themeColors && Array.isArray(preset.themeColors) && preset.themeColors.length >= 2) {
            await safeProfilePatch("theme colors", { theme_colors: [Number(preset.themeColors[0]), Number(preset.themeColors[1])] });
        } else if (typeof preset.accentColor === "number") {
            await safeProfilePatch("accent color", { accent_color: preset.accentColor, theme_colors: null });
        } else if (type === "full") {
            await safeProfilePatch("clear profile colors", { accent_color: null, theme_colors: null });
        }
    }

    // 11. Avatar Decoration, Profile Effect, Profile Border/Frame, Nameplate
    if (doProfile) {
        const cleanDecoration = (preset.avatarDecorationSkuId && preset.avatarDecorationSkuId !== "0" && preset.avatarDecorationSkuId !== "none") ? preset.avatarDecorationSkuId : null;
        const cleanEffect = (preset.profileEffectId && preset.profileEffectId !== "0" && preset.profileEffectId !== "none") ? preset.profileEffectId : null;
        const cleanFrame = (preset.profileFrameSkuId && preset.profileFrameSkuId !== "0" && preset.profileFrameSkuId !== "none") ? preset.profileFrameSkuId : null;
        const cleanNameplate = (preset.nameplateSkuId && preset.nameplateSkuId !== "0" && preset.nameplateSkuId !== "none") ? preset.nameplateSkuId : null;

        const collectiblesPatch: Record<string, unknown> = {
            avatar_decoration_sku_id: cleanDecoration,
            profile_effect_id: cleanEffect,
            profile_frame_sku_id: cleanFrame,
            nameplate_sku_id: cleanNameplate
        };

        const ok = await safeProfilePatch("collectibles", collectiblesPatch);
        if (!ok) {
            await safeAccountPatch("decoration", { avatar_decoration_sku_id: cleanDecoration });
            await safeAccountPatch("profile effect", { profile_effect_id: cleanEffect });
            await safeAccountPatch("profile frame", { profile_frame_sku_id: cleanFrame });
            await safeAccountPatch("nameplate", { nameplate_sku_id: cleanNameplate });
        }
    }

    // 12. REFRESH DISCORD STORES AND CLEAR PENDING CHANGES POPUP
    try {
        if (FluxDispatcher) {
            FluxDispatcher.dispatch({ type: "USER_PROFILE_SETTINGS_RESET_PENDING_CHANGES" });

            const me = UserStore.getCurrentUser();
            if (me?.id) {
                const [freshAccount, freshProfile] = await Promise.all([
                    fetchCurrentAccount().catch(() => me),
                    RestAPI.get({
                        url: `/users/${me.id}/profile`,
                        query: { with_mutual_guilds: false, with_mutual_friends_count: false, type: "you_screen" }
                    }).then(r => r?.body).catch(() => null)
                ]);

                if (freshAccount) {
                    FluxDispatcher.dispatch({ type: "CURRENT_USER_UPDATE", user: freshAccount });
                    FluxDispatcher.dispatch({ type: "USER_UPDATE", user: freshAccount });
                }
                if (freshProfile) {
                    FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_SUCCESS", userProfile: freshProfile });
                }
            }
        }
    } catch (err) {
        console.warn("[ProfilePresets] Store refresh failed", err);
    }

    return [...new Set(failures)];
}

function showModalTopBanner(
    targetModal: HTMLElement,
    message: string,
    type: "applying" | "success" | "failure"
) {
    let banner = targetModal.querySelector(".vc-preset-applying-banner") as HTMLElement;
    if (!banner) {
        banner = document.createElement("div");
        banner.className = "vc-preset-applying-banner";
        css(banner, {
            position: "absolute",
            top: "0",
            left: "0",
            right: "0",
            padding: "12px 18px",
            fontSize: "13px",
            fontWeight: "800",
            textAlign: "center",
            zIndex: "100000",
            boxShadow: "0 6px 25px rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            borderBottom: "1px solid rgba(255,255,255,0.2)",
            transition: "all 0.3s ease",
            borderTopLeftRadius: "inherit",
            borderTopRightRadius: "inherit"
        });
        if (targetModal.style.position !== "relative" && targetModal.style.position !== "absolute") {
            targetModal.style.position = "relative";
        }
        targetModal.prepend(banner);
    }

    if (!document.getElementById("vc-preset-banner-keyframes")) {
        const style = document.createElement("style");
        style.id = "vc-preset-banner-keyframes";
        style.textContent = `
            @keyframes vcYellowShimmer {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
            }
            @keyframes vcSpinSlow {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.append(style);
    }

    banner.style.display = "flex";
    const spinnerSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation: vcSpinSlow 0.8s infinite linear;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;

    if (type === "applying") {
        css(banner, {
            background: "linear-gradient(90deg, #f59e0b, #eab308, #f59e0b)",
            backgroundSize: "200% 200%",
            color: "#000000",
            animation: "vcYellowShimmer 1.5s infinite ease-in-out"
        });
        banner.innerHTML = `${spinnerSvg} <span>${message}</span>`;
    } else if (type === "success") {
        css(banner, {
            background: "linear-gradient(90deg, #10b981, #059669)",
            color: "#ffffff",
            animation: "none"
        });
        banner.innerHTML = `<span>[SUCCESS]</span> <span>${message}</span>`;
    } else {
        css(banner, {
            background: "linear-gradient(90deg, #ef4444, #dc2626)",
            color: "#ffffff",
            animation: "none"
        });
        banner.innerHTML = `<span>[NOTE]</span> <span>${message}</span>`;
    }
}

function removeModalTopBanner(targetModal: HTMLElement) {
    const banner = targetModal.querySelector(".vc-preset-applying-banner");
    if (banner) banner.remove();
}

async function applyPresetWithUI(
    preset: ProfilePreset,
    targetModal: HTMLElement,
    onSuccessClose?: () => void,
    clickedButton?: HTMLButtonElement
) {
    let lockOverlay = targetModal.querySelector(".vc-preset-lock-overlay") as HTMLElement;
    if (!lockOverlay) {
        lockOverlay = document.createElement("div");
        lockOverlay.className = "vc-preset-lock-overlay";
        css(lockOverlay, {
            position: "absolute",
            inset: "0",
            background: "rgba(0, 0, 0, 0.45)",
            backdropFilter: "blur(2px)",
            zIndex: "99999",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            color: "white",
            fontWeight: "700",
            fontSize: "14px",
            borderRadius: "inherit",
            pointerEvents: "all",
            cursor: "wait"
        });
        const spinnerBig = document.createElement("div");
        spinnerBig.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="3" style="animation: vcSpinSlow 0.8s infinite linear;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
        const lockText = document.createElement("div");
        lockText.textContent = `Applying "${preset.name}"... Saving profile on Discord.`;
        lockOverlay.append(spinnerBig, lockText);
        if (targetModal.style.position !== "relative" && targetModal.style.position !== "absolute") {
            targetModal.style.position = "relative";
        }
        targetModal.append(lockOverlay);
    }

    if (clickedButton) {
        clickedButton.disabled = true;
        clickedButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation: vcSpinSlow 0.8s infinite linear;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Applying...`;
        css(clickedButton, { opacity: "0.6", cursor: "wait" });
    }

    showModalTopBanner(targetModal, `Applying preset "${preset.name}"... Saving cosmetics to Discord servers...`, "applying");

    try {
        const failures = await applyPreset(preset);
        if (failures.length === 0) {
            showModalTopBanner(targetModal, `Preset "${preset.name}" applied successfully! All cosmetics saved.`, "success");
            toast(`Applied "${preset.name}".`, Toasts.Type.SUCCESS);
            await new Promise(r => setTimeout(r, 700));
            if (lockOverlay) lockOverlay.remove();
            removeModalTopBanner(targetModal);
            if (onSuccessClose) onSuccessClose();
        } else {
            if (lockOverlay) lockOverlay.remove();
            showModalTopBanner(targetModal, `Applied with notes: ${failures.join(", ")}`, "failure");
            toast(`Applied with notes: ${failures.join(", ")}`, Toasts.Type.FAILURE);
            if (clickedButton) {
                clickedButton.disabled = false;
                clickedButton.textContent = "Apply";
                css(clickedButton, { opacity: "1", cursor: "pointer" });
            }
        }
    } catch (err) {
        if (lockOverlay) lockOverlay.remove();
        console.error("[ProfilePresets] applyPreset error", err);
        showModalTopBanner(targetModal, `Failed to apply preset: ${err instanceof Error ? err.message : String(err)}`, "failure");
        if (clickedButton) {
            clickedButton.disabled = false;
            clickedButton.textContent = "Apply";
            css(clickedButton, { opacity: "1", cursor: "pointer" });
        }
    }
}

function exportPresetsToFile(presetsToExport: ProfilePreset[], filename = "all-discord-profile-presets.json") {
    const jsonStr = JSON.stringify(presetsToExport, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast(`Exported ALL ${presetsToExport.length} preset(s) to ${filename}`, Toasts.Type.SUCCESS);
}

async function importPresetsFromFile(): Promise<void> {
    return new Promise((resolve) => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".json";

        fileInput.onchange = async () => {
            const file = fileInput.files?.[0];
            if (!file) {
                resolve();
                return;
            }

            try {
                const content = await file.text();
                const data = JSON.parse(content);

                let importedList: ProfilePreset[] = [];
                if (Array.isArray(data)) {
                    importedList = data;
                } else if (data && typeof data === "object" && data.id && data.name) {
                    importedList = [data as ProfilePreset];
                } else {
                    toast("Invalid preset file format.", Toasts.Type.FAILURE);
                    resolve();
                    return;
                }

                const existing = await getPresets();
                const existingIds = new Set(existing.map(p => p.id));
                let addedCount = 0;

                for (const p of importedList) {
                    if (!p.id) p.id = crypto.randomUUID();
                    if (!p.name) p.name = "Imported Preset";

                    if (!existingIds.has(p.id)) {
                        existing.unshift(p);
                        existingIds.add(p.id);
                        addedCount++;
                    } else {
                        p.id = crypto.randomUUID();
                        p.name = `${p.name} (Copy)`;
                        existing.unshift(p);
                        addedCount++;
                    }
                    if (Native?.savePresetFiles) {
                        Native.savePresetFiles(p).catch(() => {});
                    }
                }

                await setPresets(existing);
                toast(`Successfully imported ALL ${addedCount} preset(s)!`, Toasts.Type.SUCCESS);
                openModal();
            } catch (err) {
                console.error("[ProfilePresets] Import failed", err);
                toast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, Toasts.Type.FAILURE);
            }
            resolve();
        };

        fileInput.click();
    });
}

function css(element: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
    Object.assign(element.style, styles);
}

function makeButton(text: string, iconSvg?: string, kind: "primary" | "danger" | "secondary" | "accent" = "primary") {
    const button = document.createElement("button");

    if (iconSvg) {
        const iconSpan = document.createElement("span");
        iconSpan.innerHTML = iconSvg;
        css(iconSpan, { display: "inline-flex", alignItems: "center", justifyContent: "center" });
        button.append(iconSpan);
    }

    if (text) {
        const textSpan = document.createElement("span");
        textSpan.textContent = text;
        button.append(textSpan);
    }

    const bgMap = {
        primary: "var(--button-positive-background, #23a55a)",
        secondary: "var(--background-modifier-active, #35373c)",
        danger: "var(--button-danger-background, #da373c)",
        accent: "linear-gradient(135deg, #5865f2, #eb459e)"
    };

    css(button, {
        border: "none",
        borderRadius: "8px",
        padding: text ? "8px 14px" : "8px 10px",
        fontWeight: "600",
        fontSize: "13px",
        cursor: "pointer",
        color: "white",
        background: bgMap[kind],
        transition: "all 0.15s ease",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)"
    });

    button.onmouseenter = () => { button.style.opacity = "0.9"; button.style.transform = "translateY(-1px)"; };
    button.onmouseleave = () => { button.style.opacity = "1"; button.style.transform = "translateY(0)"; };

    return button;
}

function makeCustomSelect(
    options: { value: string; label: string }[],
    defaultValue: string,
    onChange: (val: string) => void
): HTMLElement {
    const container = document.createElement("div");
    css(container, { position: "relative", width: "180px", userSelect: "none", flexShrink: "0" });

    let selectedValue = defaultValue;

    const trigger = document.createElement("button");
    trigger.type = "button";
    css(trigger, {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        background: "#111214",
        color: "#f2f3f5",
        border: "1px solid rgba(88, 101, 242, 0.4)",
        borderRadius: "8px",
        padding: "10px 14px",
        fontSize: "13px",
        fontWeight: "600",
        cursor: "pointer",
        outline: "none",
        boxSizing: "border-box",
        transition: "all 0.15s ease"
    });

    const labelSpan = document.createElement("span");
    const currentOpt = options.find(o => o.value === selectedValue) || options[0];
    labelSpan.textContent = currentOpt ? currentOpt.label : "Select Option";

    const arrow = document.createElement("span");
    arrow.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    css(arrow, { display: "inline-flex", transition: "transform 0.2s ease", color: "#b5bac1" });

    trigger.append(labelSpan, arrow);

    const menu = document.createElement("div");
    css(menu, {
        position: "absolute",
        top: "calc(100% + 4px)",
        left: "0",
        right: "0",
        background: "#18191c",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: "10px",
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.75)",
        zIndex: "999999",
        overflow: "hidden",
        display: "none",
        padding: "4px"
    });

    function toggleMenu(open?: boolean) {
        const isOpen = open ?? menu.style.display === "none";
        menu.style.display = isOpen ? "block" : "none";
        arrow.style.transform = isOpen ? "rotate(180deg)" : "rotate(0deg)";
    }

    trigger.onclick = (e) => {
        e.stopPropagation();
        toggleMenu();
    };

    function renderMenuItems() {
        menu.innerHTML = "";
        options.forEach(opt => {
            const isSelected = opt.value === selectedValue;
            const item = document.createElement("div");
            css(item, {
                padding: "8px 12px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: "600",
                color: isSelected ? "#5865f2" : "#dbdee1",
                background: isSelected ? "rgba(88, 101, 242, 0.15)" : "transparent",
                cursor: "pointer",
                transition: "all 0.12s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
            });

            const textSpan = document.createElement("span");
            textSpan.textContent = opt.label;
            item.append(textSpan);

            if (isSelected) {
                const check = document.createElement("span");
                check.innerHTML = ICONS.apply;
                css(check, { color: "#5865f2", display: "inline-flex", alignItems: "center" });
                item.append(check);
            }

            item.onmouseenter = () => { if (opt.value !== selectedValue) item.style.background = "rgba(255, 255, 255, 0.05)"; };
            item.onmouseleave = () => { if (opt.value !== selectedValue) item.style.background = "transparent"; };

            item.onclick = (e) => {
                e.stopPropagation();
                selectedValue = opt.value;
                labelSpan.textContent = opt.label;
                renderMenuItems();
                toggleMenu(false);
                onChange(opt.value);
            };

            menu.append(item);
        });
    }

    renderMenuItems();

    const outsideClickListener = (e: MouseEvent) => {
        if (!container.contains(e.target as Node)) {
            toggleMenu(false);
        }
    };
    window.addEventListener("click", outsideClickListener, true);

    container.append(trigger, menu);
    return container;
}

function openConfirmModal(title: string, message: string, onConfirm: () => Promise<void> | void, confirmBtnLabel = "Confirm", isDanger = true) {
    const CONFIRM_ID = "vc-profile-presets-confirm-modal";
    closeModal(CONFIRM_ID);

    const overlay = document.createElement("dialog");
    overlay.id = CONFIRM_ID;
    css(overlay, {
        position: "fixed",
        inset: "0",
        margin: "auto",
        border: "none",
        padding: "0",
        width: "fit-content",
        height: "fit-content",
        background: "transparent",
        zIndex: "999999"
    });

    const backdropStyle = document.createElement("style");
    backdropStyle.textContent = `#${CONFIRM_ID}::backdrop { background: rgba(0,0,0,0.8); backdrop-filter: blur(4px); }`;
    overlay.append(backdropStyle);

    const box = document.createElement("div");
    css(box, {
        width: "420px",
        padding: "24px",
        borderRadius: "16px",
        background: "#1e1f22",
        color: "white",
        boxShadow: "0 20px 60px rgba(0,0,0,0.85)",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        border: "1px solid rgba(255,255,255,0.12)"
    });

    const h = document.createElement("h3");
    h.textContent = title;
    css(h, { margin: "0", fontSize: "18px", fontWeight: "700", color: isDanger ? "#f23f43" : "#ffffff" });

    const p = document.createElement("p");
    p.textContent = message;
    css(p, { margin: "0", fontSize: "14px", color: "#dbdee1", lineHeight: "1.4" });

    const btns = document.createElement("div");
    css(btns, { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" });

    const cancel = makeButton("Cancel", ICONS.close, "secondary");
    cancel.onclick = () => closeModal(CONFIRM_ID);

    const confirm = makeButton(confirmBtnLabel, isDanger ? ICONS.delete : ICONS.apply, isDanger ? "danger" : "primary");
    confirm.onclick = async () => {
        closeModal(CONFIRM_ID);
        await onConfirm();
    };

    btns.append(cancel, confirm);
    box.append(h, p, btns);
    overlay.append(box);

    overlay.onclick = (e) => { if (e.target === overlay) closeModal(CONFIRM_ID); };
    document.body.append(overlay);
    overlay.showModal();
}

function openRenameModal(preset: ProfilePreset, onSaved: () => void) {
    const RENAME_ID = "vc-profile-presets-rename-modal";
    closeModal(RENAME_ID);

    const overlay = document.createElement("dialog");
    overlay.id = RENAME_ID;
    css(overlay, {
        position: "fixed",
        inset: "0",
        margin: "auto",
        border: "none",
        padding: "0",
        width: "fit-content",
        height: "fit-content",
        background: "transparent",
        zIndex: "20000"
    });

    const backdropStyle = document.createElement("style");
    backdropStyle.textContent = `#${RENAME_ID}::backdrop { background: rgba(0,0,0,0.8); backdrop-filter: blur(4px); }`;
    overlay.append(backdropStyle);

    const box = document.createElement("div");
    css(box, {
        width: "400px",
        padding: "24px",
        borderRadius: "16px",
        background: "#1e1f22",
        color: "white",
        boxShadow: "0 20px 60px rgba(0,0,0,0.85)",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        border: "1px solid rgba(255,255,255,0.12)"
    });

    const h = document.createElement("h3");
    h.textContent = `Rename Preset: ${preset.name}`;
    css(h, { margin: "0", fontSize: "17px", fontWeight: "700" });

    const input = document.createElement("input");
    input.value = preset.name;
    css(input, {
        width: "100%",
        boxSizing: "border-box",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "8px",
        padding: "10px 14px",
        background: "#111214",
        color: "white",
        fontSize: "14px",
        outline: "none"
    });

    const btns = document.createElement("div");
    css(btns, { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" });

    const cancel = makeButton("Cancel", ICONS.close, "secondary");
    cancel.onclick = () => closeModal(RENAME_ID);

    const save = makeButton("Save New Name", ICONS.rename, "primary");
    save.onclick = async () => {
        const newName = input.value.trim();
        if (!newName) {
            toast("Please enter a valid preset name", Toasts.Type.FAILURE);
            return;
        }
        closeModal(RENAME_ID);
        const presets = await getPresets();
        const index = presets.findIndex(p => p.id === preset.id);
        if (index !== -1) {
            presets[index].name = newName;
            await setPresets(presets);
            if (Native?.savePresetFiles) {
                Native.savePresetFiles(presets[index]).catch(() => {});
            }
            toast(`Renamed preset to "${newName}"`, Toasts.Type.SUCCESS);
            onSaved();
        }
    };

    btns.append(cancel, save);
    box.append(h, input, btns);
    overlay.append(box);

    overlay.onclick = (e) => { if (e.target === overlay) closeModal(RENAME_ID); };
    document.body.append(overlay);
    overlay.showModal();
    window.setTimeout(() => input.focus(), 50);
}

function closeModal(id: string) {
    const modal = document.getElementById(id) as HTMLDialogElement | null;
    if (!modal) return;
    if (modal.open) modal.close();
    modal.remove();
}

function renderPresetPreviewCard(preset: ProfilePreset): HTMLElement {
    const type = preset.presetType || "full";



    // 2. CONNECTED ACCOUNTS PRESET CARD
    if (type === "connections") {
        const card = document.createElement("div");
        css(card, {
            width: "420px",
            borderRadius: "16px",
            overflow: "hidden",
            background: "#111214",
            boxShadow: "0 24px 60px rgba(0,0,0,0.85)",
            color: "#f2f3f5",
            fontFamily: "var(--font-primary, gg sans, sans-serif)",
            border: "1px solid rgba(35, 165, 90, 0.4)",
            position: "relative",
            display: "flex",
            flexDirection: "column"
        });

        const banner = document.createElement("div");
        css(banner, { padding: "20px", background: "linear-gradient(135deg, #23a55a, #00b0f4)", position: "relative" });

        const bannerTitle = document.createElement("h3");
        bannerTitle.textContent = preset.name;
        css(bannerTitle, { margin: "0", fontSize: "18px", fontWeight: "800", color: "white" });

        const badge = document.createElement("div");
        badge.textContent = "🔗 CONNECTED ACCOUNTS PRESET";
        css(badge, { fontSize: "10px", fontWeight: "800", color: "rgba(255,255,255,0.85)", marginTop: "4px" });

        banner.append(bannerTitle, badge);

        const body = document.createElement("div");
        css(body, { padding: "20px", display: "flex", flexDirection: "column", gap: "10px" });

        if (Array.isArray(preset.userConnections) && preset.userConnections.length > 0) {
            for (const conn of preset.userConnections) {
                const item = document.createElement("div");
                css(item, {
                    padding: "10px 14px",
                    borderRadius: "10px",
                    background: "#1e1f22",
                    border: "1px solid rgba(255,255,255,0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                });

                const left = document.createElement("div");
                left.innerHTML = `<span style="font-weight:700; color:white; text-transform:capitalize;">${conn.type}</span>: <span style="color:#dbdee1;">${conn.name}</span>`;

                const visibilityTag = document.createElement("span");
                visibilityTag.textContent = conn.visibility === 1 ? "Visible" : "Hidden";
                css(visibilityTag, {
                    fontSize: "11px",
                    fontWeight: "700",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    background: conn.visibility === 1 ? "rgba(35, 165, 90, 0.2)" : "rgba(255, 255, 255, 0.1)",
                    color: conn.visibility === 1 ? "#23a55a" : "#b5bac1"
                });

                item.append(left, visibilityTag);
                body.append(item);
            }
        } else {
            const empty = document.createElement("div");
            empty.textContent = "No connected accounts stored in this preset.";
            css(empty, { fontSize: "13px", color: "#b5bac1", fontStyle: "italic" });
            body.append(empty);
        }

        card.append(banner, body);
        return card;
    }

    // 3. FULL PROFILE / PROFILE ONLY PRESET CARD
    const card = document.createElement("div");
    css(card, {
        width: "360px",
        borderRadius: "16px",
        overflow: "hidden",
        background: "#111214",
        boxShadow: "0 24px 60px rgba(0,0,0,0.85)",
        color: "#f2f3f5",
        fontFamily: "var(--font-primary, gg sans, sans-serif)",
        border: "1px solid rgba(255,255,255,0.12)",
        position: "relative",
        display: "flex",
        flexDirection: "column"
    });

    const banner = document.createElement("div");
    const primaryHex = preset.themeColors?.[0] ? `#${preset.themeColors[0].toString(16).padStart(6, "0")}` : (preset.accentColor ? `#${preset.accentColor.toString(16).padStart(6, "0")}` : "#5865f2");
    const secondaryHex = preset.themeColors?.[1] ? `#${preset.themeColors[1].toString(16).padStart(6, "0")}` : primaryHex;

    css(banner, { height: "128px", width: "100%", position: "relative", background: `linear-gradient(135deg, ${primaryHex}, ${secondaryHex})` });

    if (preset.banner) {
        const img = document.createElement("img");
        img.src = preset.banner;
        css(img, { width: "100%", height: "100%", objectFit: "cover", display: "block" });
        banner.append(img);
    }

    const typeBadge = document.createElement("div");
    const typeLabels: Record<string, string> = { full: "FULL PRESET", profile: "PROFILE ONLY" };
    typeBadge.textContent = typeLabels[preset.presetType || "full"] || "FULL PRESET";
    css(typeBadge, {
        position: "absolute",
        top: "10px",
        right: "10px",
        fontSize: "9px",
        fontWeight: "800",
        letterSpacing: "0.5px",
        padding: "3px 8px",
        borderRadius: "12px",
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(6px)",
        color: "#ffffff",
        border: "1px solid rgba(255,255,255,0.2)"
    });
    banner.append(typeBadge);

    const avatarContainer = document.createElement("div");
    css(avatarContainer, {
        position: "absolute",
        left: "16px",
        top: "82px",
        width: "80px",
        height: "80px",
        borderRadius: "50%",
        border: "6px solid #111214",
        background: "#2b2d31",
        boxSizing: "content-box",
        overflow: "visible"
    });

    const avatarInner = document.createElement("div");
    css(avatarInner, { width: "80px", height: "80px", borderRadius: "50%", overflow: "hidden", position: "relative" });

    if (preset.avatar) {
        const avatarImg = document.createElement("img");
        avatarImg.src = preset.avatar;
        css(avatarImg, { width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" });
        avatarInner.append(avatarImg);
    }
    avatarContainer.append(avatarInner);

    const statusDot = document.createElement("div");
    css(statusDot, {
        position: "absolute", right: "0px", bottom: "0px", width: "18px", height: "18px", borderRadius: "50%", background: "#23a55a", border: "3.5px solid #111214"
    });
    avatarContainer.append(statusDot);

    if (preset.customStatus?.text) {
        const speechBubble = document.createElement("div");
        speechBubble.textContent = `${preset.customStatus.emojiName ?? ""} ${preset.customStatus.text}`.trim();
        css(speechBubble, {
            position: "absolute",
            right: "16px",
            top: "92px",
            maxWidth: "180px",
            padding: "6px 10px",
            borderRadius: "12px",
            background: "rgba(30, 31, 34, 0.95)",
            backdropFilter: "blur(4px)",
            border: "1px solid rgba(255,255,255,0.12)",
            fontSize: "12px",
            color: "white",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)"
        });
        banner.append(speechBubble);
    }

    const content = document.createElement("div");
    css(content, { padding: "52px 16px 16px 16px", background: "#111214", display: "flex", flexDirection: "column", gap: "12px" });

    const headerBox = document.createElement("div");
    const nameRow = document.createElement("div");
    css(nameRow, { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" });

    const nameEl = document.createElement("div");
    nameEl.textContent = preset.globalName || preset.name || "Display Name";
    css(nameEl, { fontWeight: "700", fontSize: "18px", color: "white" });

    if (preset.displayNameColors && preset.displayNameColors.length > 0) {
        const hexes = preset.displayNameColors.map(c => `#${c.toString(16).padStart(6, "0")}`);
        if (hexes.length > 1) {
            nameEl.style.background = `linear-gradient(135deg, ${hexes.join(", ")})`;
            nameEl.style.webkitBackgroundClip = "text";
            nameEl.style.webkitTextFillColor = "transparent";
        } else {
            nameEl.style.color = hexes[0];
        }
    }
    nameRow.append(nameEl);

    if (preset.primaryGuildId) {
        const tagBadge = document.createElement("span");
        tagBadge.textContent = "CLAN";
        css(tagBadge, {
            fontSize: "10px", fontWeight: "800", background: "rgba(88,101,242,0.25)", color: "#5865f2", padding: "2px 6px", borderRadius: "4px", border: "1px solid rgba(88,101,242,0.4)"
        });
        nameRow.append(tagBadge);
    }
    headerBox.append(nameRow);

    if (preset.pronouns) {
        const pronouns = document.createElement("div");
        pronouns.textContent = preset.pronouns;
        css(pronouns, { fontSize: "12px", color: "#b5bac1", marginTop: "2px" });
        headerBox.append(pronouns);
    }

    content.append(headerBox);

    if (preset.bio) {
        const bioCard = document.createElement("div");
        css(bioCard, { padding: "12px", borderRadius: "10px", background: "#1e1f22", border: "1px solid rgba(255,255,255,0.06)" });
        const bioHeader = document.createElement("div");
        bioHeader.textContent = "ABOUT ME";
        css(bioHeader, { fontSize: "11px", fontWeight: "800", color: "#b5bac1", marginBottom: "6px", letterSpacing: "0.5px" });
        const bioText = document.createElement("div");
        bioText.textContent = preset.bio;
        css(bioText, { fontSize: "13px", whiteSpace: "pre-wrap", color: "#dbdee1", lineHeight: "1.4" });
        bioCard.append(bioHeader, bioText);
        content.append(bioCard);
    }

    if (Array.isArray(preset.userConnections) && preset.userConnections.length > 0) {
        const connCard = document.createElement("div");
        css(connCard, { padding: "12px", borderRadius: "10px", background: "#1e1f22", border: "1px solid rgba(255,255,255,0.06)" });
        const connHeader = document.createElement("div");
        connHeader.textContent = "CONNECTIONS";
        css(connHeader, { fontSize: "11px", fontWeight: "800", color: "#b5bac1", marginBottom: "8px", letterSpacing: "0.5px" });

        const connGrid = document.createElement("div");
        css(connGrid, { display: "flex", flexWrap: "wrap", gap: "8px" });

        for (const conn of preset.userConnections) {
            const pill = document.createElement("div");
            css(pill, {
                display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 8px", borderRadius: "6px", background: "#111214", border: "1px solid rgba(255,255,255,0.08)", fontSize: "12px", color: conn.visibility === 1 ? "#dbdee1" : "#80848e"
            });
            pill.textContent = `${conn.type}: ${conn.name}`;
            connGrid.append(pill);
        }
        connCard.append(connHeader, connGrid);
        content.append(connCard);
    }

    card.append(banner, avatarContainer, content);
    return card;
}

// Grand Unified Preview & Studio Live Editor with Left Collapsible Drawer
function openPreviewModal(preset: ProfilePreset) {
    closeModal(PREVIEW_MODAL_ID);

    const overlay = document.createElement("dialog");
    overlay.id = PREVIEW_MODAL_ID;

    css(overlay, {
        position: "fixed",
        inset: "0",
        margin: "auto",
        border: "none",
        padding: "0",
        width: "fit-content",
        height: "fit-content",
        background: "transparent",
        overflow: "visible",
        zIndex: "10001"
    });

    const backdropStyle = document.createElement("style");
    backdropStyle.textContent = `#${PREVIEW_MODAL_ID}::backdrop { background: rgba(0, 0, 0, 0.88); backdrop-filter: blur(10px); }`;
    overlay.append(backdropStyle);

    const draft = structuredClone(preset);
    let drawerOpen = true;

    const modal = document.createElement("div");
    css(modal, {
        width: "min(960px, calc(100vw - 40px))",
        maxHeight: "min(860px, calc(100vh - 40px))",
        overflow: "hidden",
        borderRadius: "20px",
        background: "#1e1f22",
        color: "white",
        fontFamily: "var(--font-primary, sans-serif)",
        boxShadow: "0 30px 100px rgba(0,0,0,0.9)",
        display: "flex",
        flexDirection: "column",
        border: "1px solid rgba(255,255,255,0.12)"
    });

    // Top Header Bar
    const header = document.createElement("div");
    css(header, {
        padding: "16px 20px", background: "#111214", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.1)"
    });

    const titleGroup = document.createElement("div");
    css(titleGroup, { display: "flex", alignItems: "center", gap: "12px" });

    const title = document.createElement("h3");
    title.textContent = preset.name;
    css(title, { margin: "0", fontSize: "18px", fontWeight: "700" });

    const typeBadge = document.createElement("span");
    typeBadge.textContent = (preset.presetType || "full").toUpperCase();
    css(typeBadge, { fontSize: "10px", fontWeight: "800", padding: "3px 8px", borderRadius: "12px", background: "#5865f2", color: "white" });

    titleGroup.append(title, typeBadge);

    const headerActions = document.createElement("div");
    css(headerActions, { display: "flex", gap: "8px", alignItems: "center" });

    const toggleDrawerBtn = makeButton("Hide Editor", ICONS.drawer, "primary");
    toggleDrawerBtn.style.background = "#5865f2";
    const renameBtn = makeButton("Rename", ICONS.rename, "secondary");
    const exportBtn = makeButton("Export", ICONS.export, "secondary");
    const closeBtn = makeButton("", ICONS.close, "secondary");
    closeBtn.onclick = () => closeModal(PREVIEW_MODAL_ID);

    renameBtn.onclick = () => {
        openRenameModal(draft, () => {
            title.textContent = draft.name;
        });
    };

    exportBtn.onclick = () => {
        exportPresetsToFile([draft], `preset-${draft.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.json`);
    };

    headerActions.append(toggleDrawerBtn, renameBtn, exportBtn, closeBtn);
    header.append(titleGroup, headerActions);

    const splitContainer = document.createElement("div");
    css(splitContainer, { display: "flex", flex: "1", overflow: "hidden", position: "relative" });

    const drawer = document.createElement("div");
    css(drawer, {
        width: "360px", background: "#18191c", borderRight: "1px solid rgba(255,255,255,0.1)", padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "14px", flexShrink: "0"
    });

    const previewWrapper = document.createElement("div");
    css(previewWrapper, {
        flex: "1", padding: "32px", display: "flex", alignItems: "center", justifyContent: "center", background: "#111214", overflowY: "auto"
    });

    function refreshPreview() {
        previewWrapper.innerHTML = "";
        previewWrapper.append(renderPresetPreviewCard(draft));
    }

    toggleDrawerBtn.onclick = () => {
        drawerOpen = !drawerOpen;
        drawer.style.display = drawerOpen ? "flex" : "none";
        toggleDrawerBtn.style.background = drawerOpen ? "#5865f2" : "var(--background-modifier-active, #35373c)";
    };

    function makeDrawerInput(label: string, value: string, placeholder: string, onChange: (val: string) => void) {
        const grp = document.createElement("div");
        const lbl = document.createElement("label");
        lbl.textContent = label;
        css(lbl, { display: "block", fontSize: "11px", fontWeight: "700", color: "#b5bac1", marginBottom: "4px" });

        const inp = document.createElement("input");
        inp.value = value || "";
        inp.placeholder = placeholder;
        css(inp, {
            width: "100%", boxSizing: "border-box", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)", padding: "8px 10px", background: "#111214", color: "white", fontSize: "13px", outline: "none"
        });

        inp.oninput = () => {
            onChange(inp.value);
            refreshPreview();
        };

        grp.append(lbl, inp);
        return grp;
    }

    function makeDrawerTextarea(label: string, value: string, placeholder: string, onChange: (val: string) => void) {
        const grp = document.createElement("div");
        const lbl = document.createElement("label");
        lbl.textContent = label;
        css(lbl, { display: "block", fontSize: "11px", fontWeight: "700", color: "#b5bac1", marginBottom: "4px" });

        const txt = document.createElement("textarea");
        txt.value = value || "";
        txt.placeholder = placeholder;
        css(txt, {
            width: "100%", height: "70px", boxSizing: "border-box", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)", padding: "8px 10px", background: "#111214", color: "white", fontSize: "13px", outline: "none", resize: "vertical"
        });

        txt.oninput = () => {
            onChange(txt.value);
            refreshPreview();
        };

        grp.append(lbl, txt);
        return grp;
    }

    const drawerHeader = document.createElement("h4");
    drawerHeader.textContent = "Live Preset Studio Options";
    css(drawerHeader, { margin: "0", fontSize: "14px", fontWeight: "700", color: "#5865f2" });

    drawer.append(
        drawerHeader,
        makeDrawerInput("Preset Title", draft.name, "Title...", val => { draft.name = val; title.textContent = val; }),
        makeDrawerInput("Display Name", draft.globalName ?? "", "Global Display Name", val => draft.globalName = val || null),
        makeDrawerInput("Pronouns", draft.pronouns ?? "", "they/them", val => draft.pronouns = val || null),
        makeDrawerInput("Clan Tag (Guild ID)", draft.primaryGuildId ?? "", "Guild ID", val => draft.primaryGuildId = val || null),
        makeDrawerInput("Custom Status Text", draft.customStatus?.text ?? "", "Status...", val => {
            draft.customStatus = draft.customStatus ? { ...draft.customStatus, text: val } : { text: val };
        }),
        makeDrawerTextarea("About Me (Bio)", draft.bio ?? "", "Bio text...", val => draft.bio = val || null)
    );

    refreshPreview();
    splitContainer.append(drawer, previewWrapper);

    const footer = document.createElement("div");
    css(footer, { padding: "16px 20px", background: "#1e1f22", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.1)" });

    const closeBottomBtn = makeButton("Close Studio", ICONS.close, "secondary");
    closeBottomBtn.onclick = () => closeModal(PREVIEW_MODAL_ID);

    const applyBtn = makeButton("Apply Preset Now", ICONS.apply, "primary");
    applyBtn.onclick = (e) => {
        void applyPresetWithUI(draft, modal, () => {
            closeModal(PREVIEW_MODAL_ID);
            closeModal(MODAL_ID);
        }, e.currentTarget as HTMLButtonElement);
    };

    footer.append(closeBottomBtn, applyBtn);
    modal.append(header, splitContainer, footer);
    overlay.append(modal);

    overlay.onclick = (event: MouseEvent) => {
        if (event.target === overlay) closeModal(PREVIEW_MODAL_ID);
    };

    document.body.append(overlay);
    overlay.showModal();
}



async function openModal() {
    closeModal(MODAL_ID);

    const overlay = document.createElement("dialog");
    overlay.id = MODAL_ID;

    css(overlay, {
        position: "fixed", inset: "0", margin: "auto", border: "none", padding: "0", width: "fit-content", height: "fit-content", maxWidth: "none", maxHeight: "none", color: "inherit", background: "transparent", overflow: "visible", zIndex: "10000"
    });

    const backdropStyle = document.createElement("style");
    backdropStyle.textContent = `#${MODAL_ID}::backdrop { background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(6px); }`;
    overlay.append(backdropStyle);

    const modal = document.createElement("div");
    css(modal, {
        width: "min(820px, calc(100vw - 40px))", maxHeight: "min(840px, calc(100vh - 40px))", overflow: "auto", padding: "24px", borderRadius: "16px", color: "var(--text-normal, white)", background: "var(--modal-background, #1e1f22)", boxShadow: "0 24px 80px rgba(0, 0, 0, 0.75)", pointerEvents: "auto", position: "relative", fontFamily: "var(--font-primary, sans-serif)"
    });

    const stopEvent = (event: Event) => event.stopPropagation();
    for (const eventName of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"]) {
        modal.addEventListener(eventName, stopEvent);
    }

    const header = document.createElement("div");
    css(header, { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid rgba(255,255,255,0.1)" });

    const titleGroup = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = "Profile Presets Studio";
    css(title, { margin: "0", fontSize: "20px", fontWeight: "700", color: "#5865f2" });

    const subtitle = document.createElement("p");
    subtitle.textContent = "Full Profile, Profile Only, or Connected Apps manager.";
    css(subtitle, { margin: "4px 0 0 0", fontSize: "12px", color: "var(--text-muted, #b5bac1)" });

    titleGroup.append(title, subtitle);

    const headerActions = document.createElement("div");
    css(headerActions, { display: "flex", gap: "8px" });

    const exportAllBtn = makeButton("Export All", ICONS.export, "secondary");
    exportAllBtn.onclick = async () => {
        const presets = await getPresets();
        if (presets.length === 0) {
            toast("No presets to export.", Toasts.Type.FAILURE);
            return;
        }
        exportPresetsToFile(presets, `all-profile-presets-${Date.now()}.json`);
    };

    const importBtn = makeButton("Import JSON", ICONS.import, "accent");
    importBtn.onclick = () => void importPresetsFromFile();

    const closeBtn = makeButton("", ICONS.close, "secondary");
    closeBtn.onclick = () => closeModal(MODAL_ID);

    headerActions.append(exportAllBtn, importBtn, closeBtn);
    header.append(titleGroup, headerActions);

    const saveRow = document.createElement("div");
    css(saveRow, { display: "flex", gap: "10px", marginBottom: "16px", background: "var(--background-secondary, #2b2d31)", padding: "12px", borderRadius: "10px", alignItems: "center" });

    const input = document.createElement("input");
    input.placeholder = "Preset name (e.g. Anime Pink, Gamer Mode...)";
    css(input, {
        flex: "1", minWidth: "0", border: "1px solid rgba(255,255,255,0.12)", outline: "none", borderRadius: "8px", padding: "10px 14px", fontSize: "14px", color: "var(--text-normal, white)", background: "var(--input-background, #111214)", pointerEvents: "auto", userSelect: "text"
    });

    let selectedSaveScope = "full";
    const scopeOptions = [
        { value: "full", label: "Full Profile" },
        { value: "profile", label: "Profile Only" },
        { value: "connections", label: "Connected Apps" }
    ];

    const customScopeSelect = makeCustomSelect(scopeOptions, "full", val => { selectedSaveScope = val; });

    let cachedPresets: ProfilePreset[] = await getPresets();

    const saveBtn = makeButton("Save Preset", ICONS.studio, "primary");
    saveBtn.onclick = async () => {
        const name = input.value.trim();
        if (!name) {
            toast("Please enter a preset name", Toasts.Type.FAILURE);
            return;
        }

        const presets = await getPresets();
        const existingIndex = presets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());

        const doSave = async () => {
            saveBtn.disabled = true;
            try {
                const scope = selectedSaveScope as "full" | "profile" | "connections";
                const preset = await capturePreset(name, scope);
                const currentPresets = await getPresets();

                const idx = currentPresets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
                if (idx !== -1) {
                    preset.id = currentPresets[idx].id;
                    currentPresets[idx] = preset;
                } else {
                    currentPresets.unshift(preset);
                }

                await setPresets(currentPresets);
                input.value = "";
                cachedPresets = await getPresets();
                toast(`Saved preset "${name}"!`, Toasts.Type.SUCCESS);
                renderFilteredListSync();
            } catch (err) {
                console.error("[ProfilePresets] Capture error", err);
                toast(`Failed to save preset: ${err instanceof Error ? err.message : String(err)}`, Toasts.Type.FAILURE);
            } finally {
                saveBtn.disabled = false;
            }
        };

        if (existingIndex !== -1) {
            openConfirmModal(
                `Overwrite Existing Preset "${name}"?`,
                `A preset named "${name}" already exists. Do you want to replace it with your current live settings?`,
                doSave,
                "Overwrite Preset",
                true
            );
        } else {
            await doSave();
        }
    };

    saveRow.append(input, customScopeSelect, saveBtn);

    const filterRow = document.createElement("div");
    css(filterRow, { display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "10px" });

    const categories = [
        { id: "all", label: "All Presets" },
        { id: "full", label: "Full Profile" },
        { id: "profile", label: "Profile Only" },
        { id: "connections", label: "Connected Apps" }
    ];

    const filterBtns: HTMLButtonElement[] = [];
    const list = document.createElement("div");
    css(list, { minHeight: "240px", transition: "all 0.15s ease" });

    let activeFilter = "all";

    function renderFilteredListSync() {
        list.innerHTML = "";
        const filtered = activeFilter === "all" ? cachedPresets : cachedPresets.filter(p => (p.presetType || "full") === activeFilter);

        if (filtered.length === 0) {
            const empty = document.createElement("div");
            css(empty, { textAlign: "center", padding: "36px 20px", color: "var(--text-muted, #b5bac1)", background: "var(--background-secondary, #2b2d31)", borderRadius: "12px" });
            empty.innerHTML = "<div style='font-weight: 600; font-size: 14px;'>No Presets Found in Category</div><div style='font-size: 12px; margin-top: 4px;'>Select another category or save a new preset above.</div>";
            list.append(empty);
            return;
        }

        for (const preset of filtered) {
            const card = document.createElement("div");
            css(card, {
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", padding: "14px", marginBottom: "12px", borderRadius: "10px", background: "var(--background-secondary, #2b2d31)", border: "1px solid rgba(255,255,255,0.06)", transition: "border-color 0.2s ease"
            });

            card.onmouseenter = () => { card.style.borderColor = "rgba(88, 101, 242, 0.4)"; };
            card.onmouseleave = () => { card.style.borderColor = "rgba(255,255,255,0.06)"; };

            const preview = document.createElement("div");
            css(preview, { position: "relative", width: "96px", height: "60px", flexShrink: "0", overflow: "hidden", borderRadius: "8px", background: "var(--background-tertiary, #111214)", border: "1px solid rgba(255,255,255,0.1)" });

            if (preset.banner) {
                const bannerPreview = document.createElement("img");
                bannerPreview.src = preset.banner;
                css(bannerPreview, { width: "100%", height: "100%", objectFit: "cover" });
                preview.append(bannerPreview);
            } else if (preset.themeColors) {
                const [pCol, sCol] = preset.themeColors;
                preview.style.background = `linear-gradient(135deg, #${pCol.toString(16).padStart(6, "0")}, #${sCol.toString(16).padStart(6, "0")})`;
            }

            if (preset.avatar) {
                const avatarPreview = document.createElement("img");
                avatarPreview.src = preset.avatar;
                css(avatarPreview, { position: "absolute", left: "6px", bottom: "5px", width: "34px", height: "34px", objectFit: "cover", borderRadius: "50%", border: "3px solid #2b2d31" });
                preview.append(avatarPreview);
            }

            const info = document.createElement("div");
            css(info, { minWidth: "0", flex: "1" });

            const nameEl = document.createElement("div");
            nameEl.textContent = preset.name;
            css(nameEl, { fontWeight: "700", fontSize: "15px", color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });

            const typeTagMap: Record<string, string> = { full: "Full Profile", profile: "Profile Only", connections: "Connected Apps" };
            const typeText = typeTagMap[preset.presetType || "full"] || "Full Profile";

            const badge = document.createElement("div");
            badge.textContent = `${typeText} · ${new Date(preset.createdAt).toLocaleDateString()}`;
            css(badge, { marginTop: "4px", fontSize: "12px", color: "#5865f2", fontWeight: "600" });

            info.append(nameEl, badge);

            const actions = document.createElement("div");
            css(actions, { display: "flex", gap: "6px", flexShrink: "0" });

            const apply = makeButton("Apply", ICONS.apply, "primary");
            apply.onclick = (e) => {
                void applyPresetWithUI(preset, modal, () => {
                    closeModal(MODAL_ID);
                }, e.currentTarget as HTMLButtonElement);
            };

            const overwriteBtn = makeButton("", ICONS.refresh, "secondary");
            overwriteBtn.title = "Replace / Overwrite this preset with your current live settings";
            overwriteBtn.onclick = () => {
                const targetScope = (preset.presetType || "full") as "full" | "profile" | "connections";
                openConfirmModal(
                    `Overwrite "${preset.name}"?`,
                    `Are you sure you want to replace/overwrite preset "${preset.name}" (${typeTagMap[targetScope]}) with your current live Discord settings?`,
                    async () => {
                        try {
                            const freshPreset = await capturePreset(preset.name, targetScope);
                            freshPreset.id = preset.id;
                            const index = cachedPresets.findIndex(p => p.id === preset.id);
                            if (index !== -1) {
                                cachedPresets[index] = freshPreset;
                                await setPresets(cachedPresets);
                                if (Native?.savePresetFiles) {
                                    Native.savePresetFiles(freshPreset).catch(() => {});
                                }
                                cachedPresets = await getPresets();
                                toast(`Overwrote "${preset.name}" with current profile!`, Toasts.Type.SUCCESS);
                                renderFilteredListSync();
                            }
                        } catch (err) {
                            console.error("[ProfilePresets] Overwrite failed", err);
                            toast(`Overwrite failed`, Toasts.Type.FAILURE);
                        }
                    },
                    "Overwrite Now",
                    true
                );
            };

            const previewBtn = makeButton("", ICONS.preview, "secondary");
            previewBtn.title = "Live Studio & Editor";
            previewBtn.onclick = () => openPreviewModal(preset);

            const renameBtn = makeButton("", ICONS.rename, "secondary");
            renameBtn.title = "Rename Preset";
            renameBtn.onclick = () => { openRenameModal(preset, () => renderFilteredListSync()); };

            const exportSingle = makeButton("", ICONS.export, "secondary");
            exportSingle.title = "Download Config";
            exportSingle.onclick = () => { exportPresetsToFile([preset], `preset-${preset.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.json`); };

            const remove = makeButton("", ICONS.delete, "danger");
            remove.title = "Delete preset";
            remove.onclick = () => {
                openConfirmModal(
                    `Delete Preset "${preset.name}"?`,
                    `Are you sure you want to delete the preset "${preset.name}"? This action cannot be undone.`,
                    async () => {
                        cachedPresets = cachedPresets.filter(item => item.id !== preset.id);
                        await setPresets(cachedPresets);
                        if (Native?.deletePresetFile) {
                            try {
                                await Native.deletePresetFile(preset);
                            } catch (e) {
                                console.warn("[ProfilePresets] Failed to delete disk folder", e);
                            }
                        }
                        cachedPresets = await getPresets();
                        toast(`Deleted "${preset.name}".`, Toasts.Type.SUCCESS);
                        renderFilteredListSync();
                    },
                    "Delete Preset",
                    true
                );
            };

            actions.append(apply, overwriteBtn, previewBtn, renameBtn, exportSingle, remove);
            card.append(preview, info, actions);
            list.append(card);
        }
    }

    categories.forEach(cat => {
        const catBtn = document.createElement("button");
        catBtn.textContent = cat.label;
        css(catBtn, {
            border: "none", borderRadius: "6px", padding: "6px 12px", fontSize: "12px", fontWeight: "600", cursor: "pointer", color: cat.id === activeFilter ? "white" : "#b5bac1", background: cat.id === activeFilter ? "#5865f2" : "rgba(255,255,255,0.06)", transition: "all 0.15s ease"
        });

        catBtn.onclick = () => {
            activeFilter = cat.id;
            filterBtns.forEach(b => {
                b.style.background = "rgba(255,255,255,0.06)";
                b.style.color = "#b5bac1";
            });
            catBtn.style.background = "#5865f2";
            catBtn.style.color = "white";
            renderFilteredListSync();
        };

        filterBtns.push(catBtn);
        filterRow.append(catBtn);
    });

    modal.append(header, saveRow, filterRow, list);
    overlay.append(modal);

    overlay.onclick = (event: MouseEvent) => { if (event.target === overlay) closeModal(MODAL_ID); };

    document.body.append(overlay);
    overlay.showModal();
    renderFilteredListSync();
}



export default definePlugin({
    name: "ProfilePresets",
    description: "Save and switch full Discord profiles (Avatar, Banner, Display Name, Bio, Pronouns, Custom Status, Clan Tag, Connected Accounts, Display Name Styles, Accent/Theme Colors, Decorations, Borders & Profile Effects).",
    authors: [{ name: "OkzTy", id: 0n }],
    tags: ["Customisation", "Utility"],
    enabledByDefault: false,
    dependencies: ["UserAreaAPI"],
    userAreaButton: {
        icon: UserAreaPresetIcon,
        render: props => <UserAreaPresetQuickButton {...props} />
    },
    start() {
        getPresets().then(list => {
            if (Native?.syncAllToDisk) {
                Native.syncAllToDisk(list).catch(() => {});
            }
        });
    },
    stop() {}
});
