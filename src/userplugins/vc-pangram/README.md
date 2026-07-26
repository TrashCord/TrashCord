# vc-pangram

Deslopify your Discord. Flags AI-generated messages. (custom Vencord plugin)

## Disclaimer

By default, this plugin uses [Pangram's external API](https://docs.pangram.com/quickstart-rest) as its AI checker. You'll need to create an account and provide an API key from [https://www.pangram.com/apikey](https://www.pangram.com/apikey).

You can also provide a custom endpoint, which can be hosted anywhere. This endpoint must accept POST {"text": msg} and respond with "label" and "score", e.g. {"label": "Human", "score": 0.12}. "Label" must be one of {"Human", "Mixed", "AI"}, and "Score" should be a 0-1 float and will render as % AI.

## Installation

See [https://discord.com/channels/1015060230222131221/1257038407503446176](https://discord.com/channels/1015060230222131221/1257038407503446176) and/or [https://docs.vencord.dev/installing/custom-plugins/](https://docs.vencord.dev/installing/custom-plugins/)