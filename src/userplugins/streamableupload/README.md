# StreamableUpload (Vencord Userplugin)

Upload files to Streamable from Discord and post the generated link automatically.

Current version: v1.2.0

Features:
1. Adds an attach-menu action: Upload File Up to 250 MB.
2. Adds /fileupload slash command support.
3. Waits until Streamable processing and public embed readiness finish before posting the link.

## Changelog

### v1.2.0
1. Added a public embed-readiness check so Streamable links are sent only after Discord can reliably unfurl them.
2. Tuned the wait loop with faster early polling to reduce dead time while keeping embed reliability.

### v1.1.0
1. Added strict 250 MB upload limit handling with clear user-facing errors.
2. Added immediate oversized file rejection at file selection time.
3. Improved slash command draft cleanup so attachments clear reliably.
4. Added explicit draft-text cleanup for `/fileupload` command submission.
5. Refactored upload error handling to reduce duplicated strings and improve maintainability.

## Requirements

1. Vencord source/developer setup (not packaged-only install).
2. Node.js and pnpm installed.
3. Streamable account credentials.

Official docs:
1. Vencord install docs: https://docs.vencord.dev/installing/
2. Custom plugin docs: https://docs.vencord.dev/installing/custom-plugins/

## Install

Place this plugin folder in:
src/userplugins/fileShare

Then build Vencord:

Windows PowerShell
```powershell
Set-Location $HOME/Vencord
& "$env:APPDATA\npm\pnpm.cmd" build
```

macOS/Linux
```bash
cd ~/Vencord
pnpm build
```

If your runtime uses AppData dist sync (common on Windows), copy build output:

```powershell
$src = "$HOME/Vencord/dist"
$dst = "$env:APPDATA/Vencord/dist"
Copy-Item "$src\*" $dst -Recurse -Force
```

Restart Discord fully (close tray too).

## First Run

1. Open plugin settings for StreamableUpload.
2. Enter Streamable Email and Streamable Password.
3. Optional: enable Auto-Send.
4. Upload with attach menu action or /fileupload.

If credentials are missing, upload is blocked until set in settings.

## Security Notes

1. Password input is masked.
2. Plugin attempts to encrypt password with OS-backed secure storage.
3. If secure storage is unavailable on a system, local settings storage is used as fallback.
4. Recommended: use a dedicated Streamable account for this plugin only.

## Troubleshooting

1. Plugin settings are blank or missing fields.
Fix: fully quit Discord (including tray), then reopen. Confirm the plugin shown in settings is StreamableUpload.

2. Upload says credentials are required.
Fix: open StreamableUpload settings and fill Streamable Email and Streamable Password, then try again.

3. Streamable login failed (401).
Fix: re-enter email/password carefully, save, and test logging in to Streamable in browser with the same credentials.

4. Streamable blocked request (403).
Fix: check Streamable account status/verification, then retry later. Some accounts may be temporarily restricted.

5. Upload rejected (400).
Fix: try a different file. If it still fails, reduce size or re-encode to MP4 (H.264/AAC).

6. Upload keeps running then fails or times out.
Fix: wait a bit and retry. Large videos can take time to process. Test with a short MP4 clip first.

7. Link is not sent immediately after upload.
Expected behavior: this plugin waits until Streamable processing completes and the public page exposes Discord-friendly embed metadata before posting the final link.

8. Build fails on Windows due to script policy.
Fix: run pnpm via pnpm.cmd:
```powershell
& "$env:APPDATA\npm\pnpm.cmd" build
```

9. Changes do not appear after building.
Fix: copy dist output to AppData Vencord dist (Windows setup), then fully restart Discord.

