<div align="center">

# GPU Binder for Vencord

<img src="https://github.com/user-attachments/assets/09c954d1-1737-4ddb-808d-d987def27753" alt="GPU Binder for Vencord Banner" width="800" />

### Automatically binds Discord to your selected GPU preference and re-applies it after updates

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## 📌 Overview

**GPU Binder** is a Vencord plugin that lets you bind Discord directly to a specific physical graphics card (GPU) installed in your system. 

Instead of relying on generic Windows performance profiles, it dynamically detects your actual hardware (including dedicated NVIDIA/AMD cards, integrated graphics, and virtual monitors) and forces Discord to run on the exact adapter you select.

Discord updates change the installation folder path (e.g., `app-1.0.xxxx`), causing Windows to treat it as a new application and lose your previously assigned GPU preferences. This plugin automatically detects the new path and re-applies your settings.

<p align="center">
  <img src="https://github.com/user-attachments/assets/054e80bc-2281-40ea-8191-2174e7b7c29b" alt="GPU Binder Settings Showcase" width="550" />
</p>

> ⚠️ **Warning**
>
> This plugin modifies the Windows Registry (`HKCU`).
> It overrides any GPU preference set manually via:
>
> `Windows → System → Display → Graphics → Discord`

---

## 🖥 Requirements

- Windows 10 or Windows 11
- Vencord installed **from source** (locally built)
- `pnpm` installed

> Installer builds of Vencord are not supported.

---

## 📦 Installation

### 1️⃣ Navigate to your Vencord source directory

```bash
cd path/to/Vencord/src
```

### 2️⃣ Create `userplugins` folder (if missing)

```bash
mkdir -p userplugins
```

### 3️⃣ Clone this repository

```bash
cd userplugins
git clone https://github.com/UnClide/vencord-gpubinder gpuBinder
```

### 4️⃣ Build Vencord

```bash
cd ../..
pnpm build
```

### 5️⃣ Restart Vencord

- Press `Ctrl + R`
- Or use: **Vencord → Restart Client**

---

## ⚙️ Usage

1. Open **User Settings**
2. Navigate to **Vencord → Plugins**
3. Find **GpuBinder**
4. Select the actual GPU Discord should use
5. Fully close Discord with `Alt + F4` or **Quit Discord** from the system tray
6. Reopen Discord so Windows starts the GPU process on the selected adapter

That’s it. Your preference will now persist even after updates.

> ⚠️ **GPU switching requires a full Discord restart**
>
> `Ctrl + R` only reloads the Discord renderer. It does **not** restart the native GPU process, so Discord can keep using the old adapter until the app is fully closed and reopened.

---

## 🔧 How It Works

The plugin:
- **Dynamic Hardware Detection:** Detects your physical Windows graphics adapters and displays them directly in the settings menu.
- **Strict Binding:** Writes the `SpecificAdapter=...` Windows registry property to ensure Discord stays bound to the exact physical GPU you selected, even in multi-GPU systems.
- **Path Auto-Detection:** Automatically finds active `Discord.exe` and `DiscordSystemHelper.exe` paths on every startup.
- **Automatic Cleanup:** Scans for and removes stale registry entries from previous Discord versions (e.g., old `app-1.0.xxxx` folders) to keep your registry clean.
- **Persistence:** Re-applies your preferred settings automatically whenever Discord updates and changes its executable path.

No background services.  
No telemetry.  
No scheduled tasks.

## 🛠 Troubleshooting

- **Settings not applying?** Make sure to **fully quit** Discord with `Alt + F4` or **Quit Discord** from the system tray, then reopen it. A simple `Ctrl + R` is not enough for native registry changes to take effect.

---

## ❗ Important Notes

- ✅ Works only on Windows
- ❌ Not compatible with non-source Vencord installs
- 🔄 Overrides Windows Graphics Settings for Discord
- 🛠 Registry access is limited to `HKCU` (current user only)

---

## 🤝 Pairs Well With

**[PowerSync](https://github.com/UnClide/vencord-powersync)** — another Vencord plugin by the same author that automatically switches Windows power plans when a game starts and restores them when it closes. Together, GPU Binder and PowerSync give you full hardware control directly from Discord with zero third-party software.

---

## 🛡 License

This project is licensed under the **MIT License**.

See the [LICENSE](LICENSE) file for details.

---
