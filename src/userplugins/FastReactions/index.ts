import definePlugin from "@utils/types";

const MESSAGE_SELECTORS = [
    "article[role='article']",
    ".message-2qnXI6",
    ".message-1o2LEJ",
    ".container-2sjP0S",
    "[data-list-item-id^='chat-messages']",
].join(",");

let hoveredMessage: Element | null = null;

function getMessageElement(node: EventTarget | null) {
    if (!(node instanceof Element)) return null;
    return node.closest(MESSAGE_SELECTORS);
}

function findHoveredMessage(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
    if (target) {
        const found = getMessageElement(target);
        if (found) return found;
    }

    const fromPoint = document.elementFromPoint(event.clientX, event.clientY);
    return getMessageElement(fromPoint);
}

function isVisible(element: Element | null) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.offsetWidth > 0 && element.offsetHeight > 0;
}

function isReactionButton(button: HTMLButtonElement) {
    const label = button.getAttribute("aria-label")?.toLowerCase() ?? "";
    if (button.disabled) return false;
    if (!isVisible(button)) return false;
    if (/close|cancel|dismiss|reply|edit|delete|pin|copy|bookmark|more/i.test(label)) return false;
    return /react with|add reaction to|add :|react/i.test(label);
}

function findQuickReactionButtons(root: ParentNode) {
    const selectors = [
        'button[aria-label*="React with"]',
        'button[aria-label*="Add :"]',
    ].join(",");

    return Array.from(root.querySelectorAll<HTMLButtonElement>(selectors))
        .filter(isReactionButton);
}

function findAddReactionOpener(root: ParentNode) {
    const selectors = [
        'button[aria-label*="Add Reaction"]',
        'button[aria-label*="Add reaction"]',
        'button[aria-label*="React"]',
    ].join(",");

    return Array.from(root.querySelectorAll<HTMLButtonElement>(selectors))
        .find(button => isVisible(button) && !button.disabled && /add reaction|react/i.test(button.getAttribute("aria-label") ?? ""));
}

function clickLatestQuickReaction(message: Element) {
    const quickButtons = findQuickReactionButtons(document);
    if (quickButtons.length > 0) {
        quickButtons[quickButtons.length - 1].click();
        return true;
    }

    const opener = findAddReactionOpener(message);
    if (!opener) return false;

    opener.click();
    window.setTimeout(() => {
        const afterOpenButtons = findQuickReactionButtons(document);
        if (afterOpenButtons.length > 0) {
            afterOpenButtons[afterOpenButtons.length - 1].click();
        }
    }, 200);

    return true;
}

function onMouseMove(event: MouseEvent) {
    const message = findHoveredMessage(event);
    if (message === hoveredMessage) return;

    hoveredMessage = message;
    if (message) {
        console.log("Hovered message element:", message);
    } else {
        console.log("No message under cursor");
    }
}

function onClick(event: MouseEvent) {
    if (!event.ctrlKey || event.button !== 0) return;

    const message = findHoveredMessage(event);
    if (!message || message !== hoveredMessage) return;

    const reacted = clickLatestQuickReaction(message);
    if (reacted) {
        event.preventDefault();
        event.stopPropagation();
        console.log("Reacted to hovered message with latest quick-menu emoji:", message);
    }
}

export default definePlugin({
    name: "FastReactions",
    description: "This plugin will allow you to quickly react to messages with a single click.",
    authors: [{
        name: "SomeRandomDevWhoDoesNotKnowHowToCodeInTypeScript",
        id: 1000000n
    }],
    tags: ["Reactions", "Utility", "Shortcuts"],
    enabledByDefault: false,
    patches: [],
    start() {
        window.addEventListener("mousemove", onMouseMove, { passive: true });
        window.addEventListener("click", onClick, true);
    },
    stop() {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("click", onClick, true);
        hoveredMessage = null;
    },
});
