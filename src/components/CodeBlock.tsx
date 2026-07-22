/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

<<<<<<< HEAD
import { classes } from "@utils/misc";
=======
>>>>>>> 89b0fd2a5 (Update index.tsx)
import { findCssClassesLazy } from "@webpack";
import { Parser } from "@webpack/common";

const CodeContainerClasses = findCssClassesLazy("markup", "codeContainer");

/**
 * Renders code in a Discord codeblock
 */
<<<<<<< HEAD
export function CodeBlock({ className, ...props }: { content?: string, lang: string; className?: string; }) {
    return (
        <div className={classes(CodeContainerClasses.markup, className)}>
=======
export function CodeBlock(props: { content?: string, lang: string; }) {
    return (
        <div className={CodeContainerClasses.markup}>
>>>>>>> 89b0fd2a5 (Update index.tsx)
            {Parser.defaultRules.codeBlock.react(props, null, {})}
        </div>
    );
}

/**
 * Renders inline code like `this`
 */
<<<<<<< HEAD
export function InlineCode({ children, className }: { children: React.ReactNode; className?: string; }) {
    return (
        <span className={classes(CodeContainerClasses.markup, className)}>
=======
export function InlineCode({ children }: { children: React.ReactNode; }) {
    return (
        <span className={CodeContainerClasses.markup}>
>>>>>>> 89b0fd2a5 (Update index.tsx)
            <code className="inline">{children}</code>
        </span>
    );
}
