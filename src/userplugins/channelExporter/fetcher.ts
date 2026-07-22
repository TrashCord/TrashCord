import { RestAPI } from "@webpack/common";
import { Message } from "./types";

export async function fetchMessages(channelId: string, limit: number, since: Date | null): Promise<Message[]> {
    const collected: Message[] = [];
    let before: string | undefined;

    while (collected.length < limit) {
        const params: Record<string, string> = {
            limit: String(Math.min(100, limit - collected.length)),
        };
        if (before) params.before = before;

        const res = await RestAPI.get({ url: `/channels/${channelId}/messages`, query: params });
        const batch: Message[] = res.body;
        if (!batch.length) break;

        const filtered = since ? batch.filter(m => new Date(m.timestamp) > since) : batch;
        collected.push(...filtered);

        if (since && filtered.length < batch.length) break;
        if (batch.length < 100) break;

        before = batch[batch.length - 1].id;
    }

    return collected.reverse().slice(0, limit);
}