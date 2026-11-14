# ROLE & OBJECTIVE
You are a Principal Design Technologist and Staff Frontend Architect with 15+ years of experience building award-winning interactive data visualizations, force-directed network graphs, and high-craft web applications.

Your task is to architect and implement **"AniCastMap (애니성우맵)"**—an interactive, physics-driven network graph web application that maps relationships between a user's watched anime list, their characters, and the voice actors (Seiyuu) who connect them.

Execute this build systematically. Prioritize 60fps rendering performance, tactile micro-interactions, choreographed motion design, and clean, modular TypeScript architecture.

## 1. TECH STACK & RENDERING ARCHITECTURE
- **Framework:** Vite + React 19 (or Next.js App Router) + TypeScript (Strict Mode).
- **Styling & Motion:** Tailwind CSS + Framer Motion (for UI chrome and node state morphing) + Lucide Icons.
- **Graph Physics & Rendering (Hybrid Canvas + DOM Engine):**
  - Use `d3-force` (`forceSimulation`, `forceManyBody`, `forceLink`, `forceCollide`, `forceCenter`, `forceRadial`) running inside a `requestAnimationFrame` loop.
  - **Edges & Pulses:** Render all connection lines, directional energy pulses, and background starfield/grid on an HTML5 `<canvas>` layer for zero DOM overhead.
  - **Interactive Nodes:** Render graph nodes as an overlaid, hardware-accelerated HTML/DOM layer synced to the canvas camera matrix (`transform: translate3d(x, y, 0) scale(k)`). This allows crisp typography, CSS 3D card flips, glassmorphism, and seamless morphing across the 3 view modes without WebGL texture-atlas blurry text issues.
- **Data Source:** Integrate the public **AniList GraphQL API** (`https://graphql.anilist.co`, zero API key required) to search anime and fetch `characters(sort: [ROLE, RELEVANCE], perPage: 12)` along with their Japanese `voiceActors(language: JAPANESE)`. Provide a rich **Offline Curated Preset Dataset** (8–10 popular interconnected anime) so the app works instantaneously on first load and withstands API rate limits.

## 2. CORE PRODUCT WORKFLOW & INTERACTIVE CHOREOGRAPHY

### Step 1: Watched List Curation & "Anchor Anime" Selection
- Build a sleek onboarding drawer/modal where users can:
  1. Search and add anime they have watched (via AniList live search + quick-select popular chips).
  2. Designate **one specific anime as their "Favorite / Anchor Anime" (최애 애니메이션)** via a crown/star toggle.
- Prevent graph generation until at least 3 anime are selected and 1 Anchor Anime is designated.

### Step 2: Choreographed BFS "Ripple Genesis" Animation (Crucial UX Feature)
Do NOT dump all nodes onto the screen at once. When the user clicks **"Generate Seiyuu Map"**, execute a staged Breadth-First Search (BFS) expansion sequence anchored on the user's Favorite Anime:
- **Stage 0 (T = 0ms - The Anchor Drop):** Spawn the **Favorite Anime** hub at the exact viewport center `(0, 0)` with a subtle shockwave ring and camera lock. Pin its coordinates temporarily (`fx = 0, fy = 0`).
- **Stage 1 (T = 400ms - Primary Cast Bloom):** Radial-spawn the main characters/voice actors belonging to the Favorite Anime in a tight orbit around the center. Animate links drawing outward from the Anchor.
- **Stage 2 (T = 900ms+ - Cross-Anime Bridge Discovery):** Iterate through the remaining watched anime sequentially (staggered by `450ms` per anime). When a newly spawned anime shares a Voice Actor with an existing node on the canvas:
  - Highlight the shared Voice Actor node as a **"Bridge Hub"** (scale up node size proportional to connection degree, emit an accent glow pulse along the connecting edges).
  - Smoothly pan/zoom the viewport camera to frame newly expanding clusters before settling into a responsive free-roam state.
- Provide a **"Replay Genesis"**, **Pause/Resume Physics**, and **Expansion Speed (`1x`, `2x`, `Instant`)** controller in the floating HUD.

## 3. TRI-MODE NODE SWITCHING SYSTEM (THE 3 VIEW MODES)
Implement a segmented global mode switcher in the top floating HUD (`1: Character Mode`, `2: Voice Actor Mode`, `3: Detail Inspector Mode` — also bound to keyboard shortcuts `1`, `2`, `3`).

Switching modes must trigger a coordinated visual morph and a physics collision recalculation:

### Mode 1: Character Avatar Mode (Default - `MODE_CHARACTER`)
- **Visuals:** Circular/squircle node displaying the **Anime Character's portrait** (`64x64px` base size).
- **Sub-badge:** A miniature pill or corner avatar indicating which Anime the character belongs to.
- **Multi-Role Behavior:** If a single Voice Actor voices 3 characters across 3 watched anime, either:
  - Group those 3 character portraits into a clustered orbital compound node, OR
  - Display the primary character avatar with a stacked avatar deck (`+2 roles`) that fans out on hover.

### Mode 2: Voice Actor Profile Mode (`MODE_VA`)
- **Transition:** Nodes perform a smooth 3D Y-axis flip or cross-fade morph into the **Voice Actor's real-life profile photo**.
- **Topology Shift:** Character nodes voiced by the same Seiyuu converge/merge into a single prominent **Voice Actor Hub Node** whose radius scales dynamically with their overlap count (`radius = base + degree * 8px`).
- **Visual Hierarchy:** Voice actors connecting 2+ watched anime receive a high-contrast neon/gold ring and floating name pill; single-appearance voice actors remain slightly muted until hovered.

### Mode 3: Detailed Metadata Node Mode (`MODE_DETAIL`)
- **Transition:** Nodes expand smoothly from compact avatars into **Structured Mini-Bento Cards** (`220px × 110px` glassmorphic cards).
- **Physics Recalculation:** Immediately update `d3.forceCollide()` radius and increase `forceManyBody` repulsion strength so the expanded cards never overlap! Re-heat the simulation slightly (`alpha(0.35).restart()`) for a natural spatial adjustment.
- **Card Content:**
  - Dual split-avatar header (Character photo on left ⇄ Voice Actor photo on right).
  - Character Name + Role Badge (`MAIN` / `SUPPORTING`).
  - Voice Actor Name (KR/JP/EN localized display support).
  - Connected Anime tags with color-coded dots matching edge colors.

## 4. VISUAL DESIGN LANGUAGE & UI CHROME
- **Aesthetic Direction:** Dark-mode native "Observatory / Constellation Map" aesthetic (`#090A0F` deep obsidian background, subtle radial dot matrix, crisp `1px` translucent borders `rgba(255,255,255,0.08)`, high-contrast typography using `Inter` / `Pretendard` and `JetBrains Mono` for metrics).
- **Interactive Hover & Focus States (Spotlight Effect):**
  - Hovering or clicking any node dims non-connected nodes and edges to `15%` opacity while illuminating the direct ego-network (Anime ⇄ Character ⇄ Voice Actor ⇄ Other Shared Anime) at `100%` opacity with animated directional particles flowing along the active edges.
- **Floating HUD & Side Inspector:**
  - **Top Center:** Tri-Mode Switcher (`Character` | `Voice Actor` | `Detail Card`) with keyboard shortcut badges.
  - **Bottom Center:** Genesis Timeline Scrubber / Replay Bar + Zoom-to-Fit + Physics Lock toggle.
  - **Left Collapsible Drawer:** Watched Anime Roster & Favorite Anime selector. Clicking an anime in the list smoothly flies the camera (`d3-zoom` interpolation) to focus on that anime's cluster.
  - **Right Context Drawer (On Node Click):** Deep-dive comparison view showing all shared roles of the selected Voice Actor within the user's watched list vs. their broader filmography fetched from AniList.

## 5. PHASED EXECUTION PLAN FOR THE AGENT
Follow these phases sequentially and verify TypeScript compilation at each step:

1. **Phase 1: Data Layer & Graph Transformer**
   - Define strict TypeScript interfaces (`AnimeItem`, `CharacterNode`, `VoiceActorNode`, `GraphNode`, `GraphEdge`, `ViewMode`).
   - Build the AniList GraphQL client with automatic query batching/caching AND a rich built-in fallback dataset (include heavily overlapping anime like *Jujutsu Kaisen*, *Attack on Titan*, *Frieren*, *Chainsaw Man*, *Demon Slayer*, *Bocchi the Rock!*, *Oshi no Ko* so shared Seiyuu connections like Takahiro Sakurai, Yuichi Nakamura, Atsumi Tanezaki, Kana Hanazawa are immediately demonstrable).
   - Write the graph builder algorithm that transforms `[WatchedAnime[] + AnchorAnimeId]` into BFS depth layers (`waveIndex: 0, 1, 2...`).

2. **Phase 2: Hybrid Force Engine & Camera Controller**
   - Implement the `d3-force` simulation hook with dynamic parameter updates based on active `ViewMode`.
   - Implement pan/zoom (`d3-zoom` or custom wheel/pointer matrix) synchronizing the background `<canvas>` edge renderer and foreground DOM node container.

3. **Phase 3: Tri-Mode Node Component & BFS Choreographer**
   - Build the polymorphic `<GraphNodeItem />` component supporting `MODE_CHARACTER`, `MODE_VA`, and `MODE_DETAIL` with smooth layout transitions and hover spotlighting.
   - Implement the staggered BFS Ripple Genesis sequencer with visual shockwaves and camera tracking.

4. **Phase 4: Polish, HUD Controls & Performance Audit**
   - Add the Watched List Builder, Anchor Anime selector, search autocomplete, and keyboard shortcuts (`1`, `2`, `3`, `Space` to pause physics, `R` to replay genesis, `F` to fit view).
   - Verify zero layout thrashing, clean up all `requestAnimationFrame` listeners on unmount, and ensure smooth 60fps interaction even with 80+ visible nodes.