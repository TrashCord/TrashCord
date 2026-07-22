/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "ProfileCollectionsAPI",
    description: "API to add collections to the user profile panel like discords game collection.",
    authors: [Devs.thororen],
    patches: [
        // message and member list popouts
        {
<<<<<<< HEAD
            find: '"UserProfilePopout");',
=======
            find: "#{intl::USER_PROFILE_FRIEND_REQUEST_TOAST}",
>>>>>>> 89b0fd2a5 (Update index.tsx)
            replacement: {
                match: /user:\i,widgets:.{0,100}?\}\),/,
                replace: "$&Vencord.Api.ProfileCollections.renderProfileCollections(arguments[0]),",
            }
        },
        // user panel popout
        {
            find: '"UserProfileAccountPopout"',
            replacement: {
                match: /user:\i,widgets:.{0,100}}\),/,
                replace: "$&Vencord.Api.ProfileCollections.renderProfileCollections(arguments[0]),",
            },
        },
        // dm sidebar
        {
            find: ".SIDEBAR,disableToolbar:",
            replacement: {
<<<<<<< HEAD
                match: /user:\i,widgets:.{0,100}?\}\),(?=.{0,100}unownedWishlistItems:\i,wishlistId:\i)/,
=======
                match: /user:(\i),widgets:.{0,100}?\}\),/,
>>>>>>> 89b0fd2a5 (Update index.tsx)
                replace: "$&Vencord.Api.ProfileCollections.renderProfileCollections({...arguments[0],isSideBar:true}),"
            }
        }
    ]
});
