/*
 * TrashCord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

declare module "typed-emitter" {
    type Listener<Events, Event extends keyof Events> = Events[Event] extends (...args: infer Args) => infer Return
        ? (...args: Args) => Return
        : never;

    type EventArgs<Events, Event extends keyof Events> = Events[Event] extends (...args: infer Args) => unknown ? Args : never;

    type TypedEmitter<Events> = {
        on<Event extends keyof Events>(event: Event, listener: Listener<Events, Event>): TypedEmitter<Events>;
        once<Event extends keyof Events>(event: Event, listener: Listener<Events, Event>): TypedEmitter<Events>;
        off<Event extends keyof Events>(event: Event, listener: Listener<Events, Event>): TypedEmitter<Events>;
        removeListener<Event extends keyof Events>(event: Event, listener: Listener<Events, Event>): TypedEmitter<Events>;
        emit<Event extends keyof Events>(event: Event, ...args: EventArgs<Events, Event>): boolean;
    };

    export default TypedEmitter;
}
