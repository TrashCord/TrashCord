# Server Mute Scheduler

A Vencord plugin that automatically mutes all your Discord servers outside your active hours and sets them to @mentions only during active hours. Includes a toggle slider in the server list and lets you exclude specific servers from being affected.

## 📋 Requirements

- **Node.js** → [nodejs.org](https://nodejs.org) (pick the LTS version)
- **Git** → [git-scm.com](https://git-scm.com)

## 🔧 Step 1 — Install Vencord from source

Open CMD and run these commands one by one:

```
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install --frozen-lockfile
pnpm run build
pnpm run inject
```

When `pnpm run inject` asks for your Discord location, enter:
`C:\Users\YOURNAME\AppData\Local\Discord`

Then fully restart Discord.

## 📁 Step 2 — Install the plugin

1. Download `ServerMuteScheduler.tsx` from this page
2. Go to this folder on your PC: `C:\Users\YOURNAME\Vencord\src\userplugins`
   - If the `userplugins` folder doesn't exist, create it
3. Inside `userplugins`, create a new folder named `mutemod`
4. Move the downloaded file into that new folder and rename it to `index.tsx`

Your final path should look like this:
`C:\Users\YOURNAME\Vencord\src\userplugins\mutemod\index.tsx`

*(Vencord accepts userplugins either as a single loose file or as a folder containing an `index.tsx` — this plugin uses the folder version.)*

## ⚙️ Step 3 — Build and launch

Run in CMD:

```
cd C:\Users\YOURNAME\Vencord
pnpm run build
```

Then open Discord → Settings → Vencord → Settings → click **Relaunch Discord**

## ✅ Step 4 — Enable the plugin

1. Go to Settings → Plugins
2. Search **ServerMuteScheduler**
3. Toggle it on
4. Click the ⚙️ icon to configure your active hours and excluded servers

## 🕐 Step 5 — Configure

| Setting | Description |
|---|---|
| Active Start | UTC hour when servers unmute (default: 16) |
| Active End | UTC hour when servers mute (default: 0) |
| Excluded Servers | Comma separated server IDs to never touch |

To get a server ID: enable Developer Mode in Discord (Settings → Advanced → Developer Mode), then right-click a server icon → Copy Server ID.

## 🎚️ Usage

A green/red slider appears at the top of your server list:
- 🟢 **ON** → scheduler is running
- 🔴 **OFF** → scheduler is paused

Click it anytime to pause or resume without going into settings.

---

⚠️ Replace `YOURNAME` with your actual Windows username in all folder paths above.
⚠️ This plugin is PC only — Vencord does not work on mobile.
