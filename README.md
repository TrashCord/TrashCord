# [<img src="https://github.com/zFrxncesck1/zFrxncesck1/blob/main/host/icons/TrashCord_icon.png" width="40" align="left" alt="TrashCord">](https://github.com/zFrxncesck1/TrashCord) TrashCord

[![Equibop](https://img.shields.io/badge/TrashCordInstaller-grey?style=flat)](https://github.com/zFrxncesck1/TrashCordInstaller)
[![My Discord](https://img.shields.io/discord/981560666915745842?color=768AD4&label=Discord&logo=discord&logoColor=white)](https://discord.gg/WhEJFWxNnX)

**TrashCord** is an underground fork of Equicord & Vencord, built for those who create without limits.  
Inspired by the **TRASH GANG** – design, music, experimentation.  
No censorship, no arbitrary rules: every plugin is welcome, every idea takes shape.

---

### Included Plugins

All Equicord plugins plus custom ones made for TrashCord.  
Check out the full list in the [`src/plugins`](./src/plugins), [`src/equicordplugins`](./src/equicordplugins) and [`src/userplugins`](./src/userplugins) folders.

---

## Installation / Uninstallation

Windows

- [GUI](https://github.com/Equicord/Equilotl/releases/latest/download/Equilotl.exe)
- [CLI](https://github.com/Equicord/Equilotl/releases/latest/download/EquilotlCli.exe)

MacOS

- [X64 GUI](https://github.com/Equicord/Equilotl/releases/latest/download/Equilotl-darwin-x64.zip)
- [ARM64 GUI](https://github.com/Equicord/Equilotl/releases/latest/download/Equilotl-darwin-arm64.zip)

Linux

- [GUI](https://github.com/Equicord/Equilotl/releases/latest/download/Equilotl-x11)
- [CLI](https://github.com/Equicord/Equilotl/releases/latest/download/EquilotlCli-Linux)
- [AUR](https://aur.archlinux.org/packages?O=0&K=equicord)

```shell
bash -c "$(curl -sS https://raw.githubusercontent.com/Equicord/Equicord/refs/heads/main/misc/install.sh)"
```

## Installing Equicord Devbuild

### Dependencies
- [Git](https://git-scm.com/download)
- [Node.js LTS](https://nodejs.org/)

Install `pnpm` (may need to run as admin/root):

```shell
npm i -g pnpm
```

> ⚠️ **Important**: After this step, close and reopen your terminal and **do not** run any further commands as admin. Using elevated privileges can mess up your Discord/TrashCord installation.

---

### Clone the repository

```shell
git clone https://github.com/zFrxncesck1/TrashCord
cd TrashCord
```

### Install dependencies and build

```shell
pnpm install --frozen-lockfile
pnpm build
```

### Inject TrashCord into Discord desktop client

```shell
pnpm inject
```

To un-inject:

```shell
pnpm uninject
```

---

## For the web (browser extension)

```shell
pnpm buildWeb
```

You'll find the ZIP file in the `dist` folder. Follow your browser’s guide for installing custom extensions.

---

## Credits

Special thanks to:
- [Vendicated](https://github.com/Vendicated) for [Vencord](https://github.com/Vendicated/Vencord)
- [Equicord](https://github.com/Equicord/Equicord) for the solid base
- [ImHisako](https://github.com/ImHisako) for [Illegalcord](https://github.com/ImHisako/Illegalcord) – inspiration and code contributions
- [TRASH GANG](https://trash-gang.com) for the underground spirit

---

## Star History

<a href="https://star-history.com/#Equicord/Equicord&Timeline">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Equicord/Equicord&type=Timeline&theme=dark&sealed_token=64drv2U7WiV6dQ5VRbOZdxHT3mRzxUzhVvfm5qt1VRpGjVPje0PbObjibX2FYe4zd-h36lCAGZ873gAgb_5_tAzUBixUVbtaLHqy1fNH6PkQP_PqPdKztatlI2s17T9IUFzRyhYynmJ1-H4idFFzEAMN1gRZlVvvmJ71P0LovJPOIqTT7uHIubWcHzxC" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Equicord/Equicord&type=Timeline&sealed_token=64drv2U7WiV6dQ5VRbOZdxHT3mRzxUzhVvfm5qt1VRpGjVPje0PbObjibX2FYe4zd-h36lCAGZ873gAgb_5_tAzUBixUVbtaLHqy1fNH6PkQP_PqPdKztatlI2s17T9IUFzRyhYynmJ1-H4idFFzEAMN1gRZlVvvmJ71P0LovJPOIqTT7uHIubWcHzxC" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Equicord/Equicord&type=Timeline&sealed_token=64drv2U7WiV6dQ5VRbOZdxHT3mRzxUzhVvfm5qt1VRpGjVPje0PbObjibX2FYe4zd-h36lCAGZ873gAgb_5_tAzUBixUVbtaLHqy1fNH6PkQP_PqPdKztatlI2s17T9IUFzRyhYynmJ1-H4idFFzEAMN1gRZlVvvmJ71P0LovJPOIqTT7uHIubWcHzxC" />
  </picture>
</a>

## Disclaimer

Discord is trademark of Discord Inc., and solely mentioned for the sake of descriptivity.
Mentioning it does not imply any affiliation with or endorsement by Discord Inc.

<details>
<summary>Using TrashCord violates Discord's terms of service</summary>

Client modifications are against Discord’s Terms of Service.

There are no known cases of bans for using Vencord/Equicord/TrashCord, but avoid posting screenshots showing the mod in servers that may be hostile to client modifications.
</details>

---

## Development & Contributions

For bug reports or suggestions, use [Issues](https://github.com/zFrxncesck1/TrashCord/issues).

---

**TrashCord – code like a vandal, create like an artist.**
