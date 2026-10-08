# English Quest — Design Context

Read this before any UI or visual change. It records who the app is for, the look we're keeping, and the rules design work should follow.

## Product

- **What:** A static web app (`index.html`, `app.js`, `content.js`, `style.css`, `base.css`) for learning English. It follows the Spotlight / «Английский в фокусе» textbooks for grades 2, 3 and 4: 34 topics, 60 levels, with speaking practice through TTS audio in `tts_cache/`.
- **Learners:** Russian-speaking children aged about 7–10. Their English is at beginner to early-elementary level.
- **Interface language:** Russian (`lang="ru"`) for all UI, instructions, and feedback. English appears only in the learning content. Keep the two visibly distinct.
- **How it's used:**
  - In lessons, with a tutor or parent next to the child, usually on a laptop or a shared screen.
  - Alone at home, usually on a tablet or phone.
  - So every screen has to work for a child reading on their own, and still be clear when a tutor points at it from arm's length.

## Visual identity: keep and refine

The theme is **Minecraft × Roblox**: a pixel/blocky world with glossy, toy-like surfaces. This is the brand, so don't replace it. The goal is to make it more consistent, polished, and readable.

Signature elements:
- **Hard offset shadows** (`--shadow-hard: 4px 4px 0`) and **3px dark outlines** (`--line`) on cards, the HUD, and buttons.
- **Pressable buttons:** a bottom shadow that collapses on `:active`.
- **Block palette**, with named tokens in `style.css :root`:
  - grass (success/progress)
  - diamond (primary/info)
  - gold (rewards/XP)
  - rose, violet
  - lava (danger/error)
  - Each color has `-2` (darker, for shading and insets) and `-3` (lighter, for highlights) variants.
- **Sky gradient background** with a faint 48px ground grid.
- **Pixel art:** inline SVG drawn with `crispEdges` / `pixelated`.
- **Characters**, each with its own color and emoji:
  - Dr. Harlow 🦌 (main guide)
  - Nurse Luna 🐰
  - Miner Max ⛏️
  - Prof. Owl 🦉
  - DJ Robo 🤖
  - Use a character's color whenever that character speaks or owns a section.

### Type
- **Press Start 2P** (`--font-pixel`): logo, headings, badges, and short labels only. Keep it under about 4 words and never use it for sentences, instructions, or learning content. It does include Cyrillic, but long Russian headings in it are slow to read, so use the body font for Russian headings longer than a few words.
- **Baloo 2 / Nunito** (`--font-body`): everything else, including all English words and phrases the child has to read or say.
- Learning content (words, phrases, questions) should be the largest text on its screen: at least 20px, and 24px+ for a word the child must read aloud.

## Priorities (in order of tie-breaking)

1. **Readability for kids:**
   - Only one task per screen.
   - Short Russian instructions.
   - Make it obvious what to tap next.
   - English content is large and clearly separated from the Russian UI.
2. **Accessibility:**
   - WCAG AA contrast in both themes. Watch white text on gold, rose, and light grass in particular.
   - Dark mode (`[data-theme="dark"]`) is a supported theme, not an afterthought, so every new component needs dark styles.
   - Visible focus rings (already in `base.css`).
   - Don't rely on color alone for right/wrong: pair it with an icon or text.
   - Honor `prefers-reduced-motion`.
3. **Mobile / tablet:**
   - Touch targets at least 44×44px, with 48px+ preferred for answer options.
   - Layouts must work at 360px wide with no horizontal scroll.
   - The existing breakpoint is 720px.
   - Modals must fit a phone screen and scroll inside themselves.
4. **Motivation / game feel:**
   - Keep XP, gold, day streaks with 🧊 freezes, levels, inventory, and characters. No hearts: mistakes are not punished, they go to «Мои ошибки».
   - Every answer gets immediate, clear feedback.
   - Rewards should feel earned and tactile: pop, press, a short burst.

## Motion

Motion should be **small and purposeful**. Use it for feedback: button presses, a correct-answer pop, a level-up moment, toasts. Avoid:
- ambient loops that pull attention while the child is reading or answering (drifting clouds, pulsing sun, bobbing avatars should be subtle or pause during a task)
- long or blocking animations (keep feedback under about 400ms)
- confetti on anything smaller than finishing a quest or reaching a new level.

## Do / Don't

- **Do** use the existing tokens. Add a new token rather than hard-coding a hex value.
- **Do** keep the outline + hard shadow language on new interactive surfaces.
- **Do** write UI copy in simple Russian a 7-year-old can read, and keep praise short and specific.
- **Don't** use the pixel font for paragraphs, instructions, or English learning content.
- **Don't** add new fonts or a new visual style that breaks the block-world feel.
- **Don't** add decorative motion to task screens.
- Emoji are fine. They're part of the current language and work as quick visual anchors for kids.
