/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { gitHash } from "@shared/vencordUserAgent";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { i18n } from "@webpack/common";

import { MiddleFinger } from "./components/loadingScreen";
import MessageMap from "./messages.json";

function vcIntlMessage(key: keyof typeof MessageMap) {
    const entry = MessageMap[key];
    const locale = i18n.intl.currentLocale as keyof typeof entry;

    return entry[locale] ?? entry["en-US"] ?? key;
}

export default definePlugin({
    name: "FunnyDiscord",
    description: "Makes the discord funnier (beware of the jokes!!!)",
    authors: [Devs.RoScripter999],
    tags: ["Fun", "Appearance"],
    enabledByDefault: false,
    MiddleFinger,
    vcIntlMessage,

    patches: [
        {
            find: "#{intl::LOADING_DID_YOU_KNOW}",
            lazy: true,
            replacement: {
                match: /\(\s*0,\s*\w+\.jsx\)\(\s*\w+\.A\s*,\s*\{[^}]*setRef\s*:\s*this\.setVideoRef[^}]*?\}\)/,
                replace: "$self.MiddleFinger()"
            }
        },
        {
            find: "#{intl::SETTINGS_NOTICE_MESSAGE})})}),",
            lazy: true,
            replacement: {
                match: /\i.intl\.string\([^)]*#{intl::SETTINGS_NOTICE_MESSAGE}\)/,
                replace: "$self.vcIntlMessage('MODS_EAT_YOU')"
            }
        },

        {
            find: "#{intl::USER_SETTINGS_CUSTOMIZE_PROFILE_EXAMPLE_BUTTON}",
            replacement: {
                match: /\w+\.intl\.string\([^)]*#{intl::USER_SETTINGS_CUSTOMIZE_PROFILE_EXAMPLE_BUTTON}\)/,
                replace: "$self.vcIntlMessage('I_AM_USELESS')"
            }
        },
        {
            find: "#{intl::SWITCH_ACCOUNTS_MODAL_SUBHEADER}",
            lazy: true,
            replacement: {
                match: /\w+\.intl\.string\([^)]*#{intl::SWITCH_ACCOUNTS_MODAL_SUBHEADER}\)/,
                replace: "$self.vcIntlMessage('SIGN_IN_SIGN_OUT_NEVER_COME_BACK')"
            }
        },
        {
            find: "#{intl::APPLICATION_ENTITLEMENT_CODE_REDEMPTION_PROMPT}",
            lazy: true,
            replacement: {
                match: /\w+\.intl\.string\([^)]*#{intl::APPLICATION_ENTITLEMENT_CODE_REDEMPTION_PROMPT}\)/,
                replace: "$self.vcIntlMessage('CODE_REDEMPTION_STEAL_DATA')"
            }
        },
        {
            find: "Need help? Check out our ",
            replacement: {
                match: /(troubleshooting guide)/,
                replace: "$1 that won\\'t help you"
            }
        },
        {
            find: ".BILLING_TRANSACTION_HISTORY_CATEGORY,",
            lazy: true,
            replacement: {
                match: /(BILLING_TRANSACTION_HISTORY_CATEGORY[^}]*useTitle:\(\)=>)\w+\.intl\.string\(\w+\.\w+\.\w+\)/,
                replace: '$1$self.vcIntlMessage("CREDIT_CARD_STEAL_HISTORY")'
            }
        }
    ],

    get gitHash() {
        return gitHash;
    }
});