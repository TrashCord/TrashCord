import { Patch } from "@utils/types";

type StockPatch = Omit<Patch, "plugin">;

interface ConfigurablePatchDefinition {
    /** Description of your patch, shown as the settings description */
    description: string;
    /** Default enable state of the patch. Defaults to true */
    default?: boolean;
    /** Patch or patches. Same as any patch defined within the `patches` array of a plugin definition */
    patches: StockPatch | StockPatch[];
}

// Record key is the setting name for the patch
const Patches: Record<string, ConfigurablePatchDefinition> = {
    removeChatboxGiftButton: {
        description: "Remove the nitro gifting button in the chatbox",
        patches: {
            find: "gifts,stickers",
            replacement: {
                match: /=\i\.gifts?/g,
                replace: "=null"
            }
        }
    },
    removeChatboxGifsButton: {
        description: "Remove the GIFs button in the chatbox",
        patches: {
            find: "gifts,stickers",
            replacement: {
                match: /=\i\.gifs?/g,
                replace: "=null"
            }
        },
        default: false
    },
    removeChatboxStickerButton: {
        description: "Remove the sticker button in the chatbox",
        patches: {
            find: "gifts,stickers",
            replacement: {
                match: /=\i\.stickers?/g,
                replace: "=null"
            }
        },
        default: false
    },

    nitroAndShopPages: {
        description: "Hide the Nitro and Shop pages in DMs",
        patches: [
            {
                // Old: \i\.\i\.APPLICATION_STORE — \i doesn't match real minified names like C.BVt
                // New: \w+\.\w+ matches any X.Y prefix
                find: "hasLibraryApplication()&&",
                replacement: [
                    {
                        match: /\w+\.\w+\.APPLICATION_STORE,/,
                        replace: "null,"
                    },
                    {
                        match: /\w+\.\w+\.COLLECTIBLES_SHOP,/,
                        replace: "null,"
                    }
                ]
            },
            {
                // PRIVATE_CHANNELS_A11Y_LABEL string no longer present in bundle — patch removed
                find: "#{intl::PRIVATE_CHANNELS_A11Y_LABEL}",
                noWarn: true,
                replacement: [
                    {
                        match: /\i\?\(0,\i\.\i\)\(.{0,250}?\},"premium"\):null,/,
                        replace: ""
                    },
                    {
                        match: /\(0,\i\.\i\)\(.{0,250}?\},"discord-shop"\),/,
                        replace: ""
                    },
                ]
            }
        ]
    },

    profileEditorShopUpsell: {
        description: "Hide the collectibles upsell banner in the Profiles settings",
        patches: {
            // Old match: COLLECTIBLES_PROFILE_SETTINGS_UPSELL).{0,300}?return — no longer has return after
            // New: insert return null before the destructuring let at top of component
            find: "COLLECTIBLES_PROFILE_SETTINGS_UPSELL,",
            replacement: {
                match: /(?=let \w+,\w+,\w+,\w+,\{analyticsLocations:\w+\}=\(0,\S+\)\(\S+\.COLLECTIBLES_PROFILE_SETTINGS_UPSELL\))/,
                replace: "return null;"
            }
        }
    },

    updateReadyButton: {
        // case"UPDATE_DOWNLOADED": no longer present in bundle — patch removed
        description: "Hide the Update Ready! button",
        patches: {
            find: 'case"UPDATE_DOWNLOADED":',
            noWarn: true,
            replacement: {
                match: /switch\(this\.props\.mode\)/,
                replace: "return null;$&"
            }
        },
        default: false
    },

    familyCenterInSettings: {
        // USER_SETTINGS_MERCH_LINK_CONFIRMED no longer present in bundle — patch removed
        description: "Hide the Family Center page in settings. Does not hide the tab in DMs",
        patches: [
            {
                find: ".USER_SETTINGS_MERCH_LINK_CONFIRMED)",
                noWarn: true,
                replacement: {
                    match: /\[\i\.\i\.PRIVACY_FAMILY_CENTER\]:\{/,
                    replace: "$&predicate:()=>false,"
                }
            }
        ]
    },
    merchandiseLink: {
        // USER_SETTINGS_MERCH_LINK_CONFIRMED no longer present in bundle — patch removed
        description: "Hide the Merch button inside settings",
        patches: {
            find: ".USER_SETTINGS_MERCH_LINK_CONFIRMED)",
            noWarn: true,
            replacement: {
                match: /\[\i\.\i\.MERCHANDISE\]:\{/,
                replace: "$&predicate:()=>false,"
            }
        }
    },
    socialLinks: {
        // USER_SETTINGS_MERCH_LINK_CONFIRMED no longer present in bundle — patch removed
        description: "Hide the links to Discord's Social Media profiles",
        patches: {
            find: ".USER_SETTINGS_MERCH_LINK_CONFIRMED)",
            noWarn: true,
            replacement: {
                match: /\[\i\.\i\.SOCIAL_LINKS\]:\{/,
                replace: "$&predicate:()=>false,"
            }
        }
    },
    paymentSettings: {
        // BILLING_SETTINGS is now only used in a marketing banner, not in a removable section array
        description: "Hide the Payment Settings section. May cause side effects.",
        patches: [
            {
                find: "#{intl::BILLING_SETTINGS}",
                noWarn: true,
                replacement: {
                    match: /\{header:.{0,30}?#{intl::BILLING_SETTINGS}.?,.+?\},/,
                    replace: ""
                }
            }
        ],
        default: false
    },

    downloadApps: {
        description: "Hide the Download Apps button in the sidebar",
        patches: {
            // Old: (function\s\i\(\){) — function name was anonymous \i, now has real minified name
            // New: function \w+(){} matches any named function
            find: "app-download-button",
            replacement: {
                match: /function (\w+)\(\)\{(?=.{0,200}?id:"app-download-button")/,
                replace: "function $1(){return null;"
            }
        }
    },

    contentInventory: {
        description: "Hide the Activity Feed in the members list",
        patches: {
            // Old: inserted return false before let — structure changed, now inside bG callback
            // New: return early inside the bG callback before getMemberCount
            find: /hasFeature\(\i\.\i\.ACTIVITY_FEED_ENABLED_BY_USER\)/,
            replacement: {
                match: /(?<=\(\)=>\{)if\(null==\w+\)return;/,
                replace: "return;"
            }
        },
        default: false
    },

    activeNow: {
        // nowPlayingColumn no longer present in bundle — patch removed
        description: "Hide the Active Now sidebar in the Friends page",
        patches: {
            find: ".nowPlayingColumn,",
            noWarn: true,
            replacement: {
                match: /,\(0,\i\.jsx\)\("div",{className:\i\.nowPlayingColumn,children:\(0,\i.jsx\)\(\i\.\i,{}\)}\)/,
                replace: ""
            }
        },
        default: false
    },

    transferToConsole: {
        // "transfer-".concat no longer present in bundle — patch removed
        description: "Hide the transfer to console button",
        patches: {
            find: '"transfer-".concat',
            noWarn: true,
            replacement: {
                match: /(?<=function \i\(\i\){)(?=let.{0,500}?"Console Transfer Item")/,
                replace: "return null;"
            }
        }
    },

    textChannelActivityNameHeader: {
        // activityPanelContainer no longer present in bundle — patch removed
        description: "Hide the activity name above expanded activities in text channels",
        patches: {
            find: ".activityPanelContainer,",
            noWarn: true,
            replacement: {
                match: /\i\?null:\(0,\i\.jsx\)\("div",{className:\i\.header,.{0,150}\i\.name}\)}\),/,
                replace: ""
            }
        }
    },

    inviteToServer: {
        description: "Hide the Invite to Server context menu option",
        patches: {
            find: 'id:"invite-to-server"',
            replacement: {
                match: /let{user:/,
                replace: "return null;$&"
            }
        }
    },

    clippingEnabledToast: {
        description: "Hide the clipping enabled; your voice may be recorded warning when joining a voice channel, without disabling your voice from being clipped",
        patches: {
            // Old: maybeShowClipsWarning(\i){ — method no longer standalone, logic is now inline
            // New: block the dispatch directly by short-circuiting the &&( branch
            find: '"CLIPS_SHOW_CALL_WARNING"',
            replacement: {
                match: /&&\([\w$.]+\.dispatch\(\{type:"CLIPS_SHOW_CALL_WARNING"/,
                replace: "&&(false&&x.x.dispatch({type:\"CLIPS_SHOW_CALL_WARNING\""
            }
        }
    },

    createInviteButtonOnChannels: {
        description: "Hide the Create Invite button on channels in the sidebar",
        patches: {
            find: 'tutorialId:"instant-invite",',
            replacement: {
                match: /(?<=return)(?=.{0,50}?"instant-invite")/,
                replace: ";"
            }
        }
    },
    editChannelButton: {
        description: "Hide the Edit Channel button on channels in the sidebar",
        patches: {
            // Old: (?<=function \i\(\i\)\{)(?=let\{channel:\i,disableManageChannels)
            // New: there's now "let t," before the destructuring inside the memo function
            find: 'tutorialId:"instant-invite",',
            replacement: {
                match: /(?<=function\(\w\)\{)let \w,\{channel:/,
                replace: "return null;let x,{channel:"
            }
        },
        default: false
    },

    boostProgressBar: {
        description: "Hide the Server Boost progress bar in all servers",
        patches: {
            // Old: \i\.push(\i\.\i\.GUILD_PREMIUM_PROGRESS_BAR) — push pattern no longer exists
            // New: the check is now inside a hasDivider helper — force the GUILD_PREMIUM_PROGRESS_BAR
            // row check to always be false so the section is treated as empty/hidden
            find: ".premiumProgressBarEnabled&&",
            replacement: {
                match: /1===(\w+)\.length&&\1\[0\]===(\w+\.\w+\.GUILD_PREMIUM_PROGRESS_BAR)/,
                replace: "false"
            }
        }
    },

    newMemberBadge: {
        // newMemberBadge}, no longer present in bundle — patch removed
        description: "Hide the new member badge",
        patches: {
            find: ".newMemberBadge},",
            noWarn: true,
            replacement: {
                match: /(?<=return)\(0,\i\.\i\)\(\i\.id,\i\.author\.id\)\?/,
                replace: " false?"
            }
        },
        default: false
    },

    questsBar: {
        description: "Hide the Quest promotions in the sidebar",
        patches: {
            find: "QUESTS_BAR,questId",
            replacement: {
                match: /(?<=return).{0,50}?\.QUESTS_BAR,questId/,
                replace: " null;$&"
            }
        }
    },

    questsActiveNow: {
        // quest: prop no longer present in the NOW_PLAYING_CARD_HOVERED component — Discord removed it
        description: "Hide the Quest promotions in the Active Now sidebar",
        patches: {
            find: 'NOW_PLAYING_CARD_HOVERED,{',
            noWarn: true,
            replacement: {
                match: /(quest:)\i}\)/,
                replace: "$1null})"
            }
        }
    },

    supportLink: {
        description: "Hide the link to Discord support in the top right",
        patches: {
            // Old: (?<=function \i\(\i\){)(?=let\{) — component now returns Anchor directly, no let destructuring
            // New: insert return null before the Anchor return
            find: "HELP_CLICKED,{highlighted",
            replacement: {
                match: /(?=return\(0,\w+\.jsx\)\(\w+\.\w+,\{href:\w+\.\w+,target:"_blank")/,
                replace: "return null;"
            }
        },
        default: false
    },

    quickSwitcherButton: {
        description: "Hide the Find or start a new conversation button",
        patches: {
            // Old: \(0,\i\.jsx\)\(\i\.\i,{.{0,50}?tutorialId:"direct-messages",.{0,600}?\}\)\}\)\}\),
            // New: component name contains $ (e.g. T$.A), use \S+ instead of \i
            find: 'tutorialId:"direct-messages",',
            replacement: {
                match: /\(0,\S+\.jsx\)\(\S+,\{childRef:\w+,tutorialId:"direct-messages",.+?\}\),/,
                replace: ""
            }
        },
        default: false
    },

    alsoKnownAs: {
        description: "Hide the AKA nicknames in DMs",
        patches: {
            find: "this.generateNicknameGuildPairs(this.user)",
            replacement: {
                match: /this\.generateNicknameGuildPairs\(this\.user\)/,
                replace: "[];$&"
            }
        },
        default: false
    },

    voiceGradientBackground: {
        // gradientBackground,children:[(0 no longer present in bundle — patch removed
        description: "Hide the gradient backgrounds in voice channels",
        patches: {
            find: '.gradientBackground,children:\[\(0',
            noWarn: true,
            all: true,
            replacement: {
                match: /\i\.\i\.getEnableHardwareAcceleration\(\)/,
                replace: "true?()=>null:$&"
            }
        },
    }
};

export default Patches;