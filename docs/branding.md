# Branding Engine - Theme Mappings

GIIN Meet provides a dynamic, design-rich interface supporting 10 distinct styling aesthetics globally selected using the DOM attribute `data-ui-style`.

---

## 1. Mapped CSS Styles
Each styling option sets specific variables inside [index.css](file:///c:/Users/hleo5/Desktop/GiinMeet/src/index.css):

### 1.1 Liquid Glass
- Gradients (`linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #311042 100%)`)
- Ultra blur filters (`backdrop-filter: blur(24px)`)
- Glass border overlays (`rgba(255, 255, 255, 0.1)`)

### 1.2 Bento Grid
- Rigid gaps (`gap: 1.25rem`)
- Thick borders (`border: 2px solid var(--border-color)`)
- Flat black drop shadows (`box-shadow: 6px 6px 0px rgba(0, 0, 0, 0.4)`)

### 1.3 Spatial UI
- 3D perspective wrapper (`perspective: 1000px`)
- Hover translation animations (`transform: translateZ(15px) scale(1.02)`)
- Soft depth shadows

### 1.4 Skeuomorphism
- Tactile raised backgrounds (`linear-gradient(145deg, #2b303b, #242832)`)
- Dual container bevels (`5px 5px 15px #15181e, -5px -5px 15px #2d323e`)
- Inset button presses (`box-shadow: inset 3px 3px 6px #161822`)

### 1.5 Minimalism
- Monochrome grayscale theme
- Sharp borders (`border-radius: 4px`)
- Flat solid backgrounds

### 1.6 Maximalism
- Neon high-contrast backgrounds (`#ff0055`, `#00ffcc`, `#ffff00`)
- Thick black board frames
- Solid offset box shadows

---

## 2. Dynamic Hydration
Style choices are saved in `localStorage.setItem('giin_ui_style', style)` and loaded on component hydration. The helper function `applyUiStyle` removes local overrides before settings changes to prevent rendering collisions.
```typescript
document.documentElement.setAttribute('data-ui-style', style);
```
