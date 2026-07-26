import { IpcMainInvokeEvent } from "electron";

export async function scorePangram(_: IpcMainInvokeEvent, text: string, apiKey: string) {
    const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": apiKey };
    try {
        const r = await fetch("https://text.external-api.pangram.com/task", {
            method: "POST", headers, body: JSON.stringify({ text, public_dashboard_link: false }),
        });
        if (!r.ok) return { error: `Pangram ${r.status}` };
        const { task_id } = await r.json();

        for (let i = 0; i < 40; i++) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            const t = await (await fetch(`https://text.external-api.pangram.com/task/${task_id}`, { headers })).json();
            if (t.stage === "STAGE_SUCCESS")
                return {
                    label: t.prediction_short || (t.fraction_ai >= 0.5 ? "AI" : "Human"),
                    pct: t.fraction_ai == null ? null : Math.round(t.fraction_ai * 100),
                };
            if (t.stage === "STAGE_FAILED") return { error: "Task failed" };
        }
        return { error: "Poll timeout" };
    } catch (e: any) {
        return { error: e.message };
    }
}

export async function scoreCustom(_: IpcMainInvokeEvent, text: string, url: string) {
    try {
        const r = await fetch(url, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
        });
        if (!r.ok) return { error: `Custom endpoint ${r.status}` };
        const { score, label } = await r.json();
        return { label, pct: score == null ? null : Math.round(score * 100) };
    } catch (e: any) {
        return { error: e.message };
    }
}
