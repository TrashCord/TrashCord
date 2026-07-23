<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:09090d,50:7f1d1d,100:dc2626&height=200&section=header&text=WeatherStatus&fontSize=60&fontColor=f5f5f5&animation=fadeIn&fontAlignY=38&desc=Live%20weather%20as%20your%20Discord%20status&descAlignY=58&descSize=16&descColor=a3a3a3" width="100%"/>

<br/>

[![Equicord](https://img.shields.io/badge/Equicord-dc2626?style=for-the-badge&logo=discord&logoColor=white&labelColor=09090d)](https://github.com/Equicord/Equicord)
[![GitHub](https://img.shields.io/badge/Naxiwow-dc2626?style=for-the-badge&logo=github&logoColor=white&labelColor=09090d)](https://github.com/Naxiwow)
[![wttr.in](https://img.shields.io/badge/wttr.in-dc2626?style=for-the-badge&logo=cloudflarepages&logoColor=white&labelColor=09090d)](https://wttr.in)

</div>

---

## About

Equicord plugin that auto-updates your Discord custom status with live weather data for any city — no API key needed.

```
⛅ 18°C · Paris
```
```
🌧️ 12°C Light Rain · London
```
```
☀️ 31°F · Tokyo
```

---

## Features

- **No API key** — uses [wttr.in](https://wttr.in), completely free
- **Any city** — set any city name in settings
- **Auto-refresh** — configurable interval (1 / 5 / 10 / 15 / 30 / 60 min)
- **Celsius or Fahrenheit**
- **Optional condition text** — toggle "Partly Cloudy" on/off
- **Optional city name** in status

---

## Settings

| Setting | Default | Description |
|---|---|---|
| **City** | — | City name (e.g. `Paris`, `Tokyo`, `New York`) |
| **Unit** | Celsius | °C or °F |
| **Show Condition** | off | Append condition text (e.g. `Partly Cloudy`) |
| **Show City** | on | Append city name to status |
| **Update Interval** | 15 min | How often to refresh (1–60 min) |

---

## Installation

Drop the `weatherStatus` folder into `src/userplugins/` in your Equicord source, then:

```bash
pnpm build
```

Restart Discord → Settings → Plugins → enable **WeatherStatus** → enter your city.

---

## Credits

- [wttr.in](https://wttr.in) — open-source weather service by Igor Chubin
- [Equicord](https://github.com/Equicord/Equicord) — the client mod

---

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:dc2626,50:7f1d1d,100:09090d&height=120&section=footer" width="100%"/>
</div>
