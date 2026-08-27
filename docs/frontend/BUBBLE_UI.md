# Bubble UI — the legibility grammar for Vivarium's 2D world

**Status:** design proposal, awaiting Safi's visual approval. No production code changed.
**Date:** 2026-07-25.
**Mockups:** `docs/frontend/mockups/bubbles/` — real chibi atlas, real neutral-temperate
terrain, real payload text, screenshotted at native resolution at 0.5x/1x/2x/4x.
**Supersedes:** the rejected overlay described in `.superpowers/sdd/legibility-overlay-report.md`
("plain square boxes over heads with no visual distinction between kinds, and no clear
correlation to whether the agent actually produced a message").

---

## 0. What this is for

Nobody will ever read the event log. This overlay is the only place the beings' inner
lives become perceptible. The target is therefore not "UI that labels events correctly"
— that is the floor. The target is a visual language that makes a viewer feel they are
watching someone's inner life surface, and that stays beautiful at the tenth viewing.

Two tests govern every decision below:

1. Would a demanding designer be impressed?
2. Would a stranger watching for thirty seconds feel they were seeing a **world**,
   rather than reading a **UI**?

Consequences that follow, and that the rest of this document obeys:

- **The bubble body is always the same cream vellum.** Family colour appears only as a
  thin accent — a stem, a 2px edge bar, the glyph ink. Six saturated bubble fills would
  read as a candy HUD; one vellum chip with a coloured detail reads as a painted sign in
  a warm, muted world.
- **Restraint is the craft.** At rest the world shows almost nothing. Motion appears
  only where it carries meaning. Exactly two bubbles in the entire vocabulary invert
  their field, and they are birth and death.
- **Never claim more than the simulation knows.** Every mark is derived from a real
  event payload. Nothing infers mood, intent, or persona.

---

## 1. Research summary — what 2D games actually do

**Comic-lettering grammar** (Blambot's comic grammar reference; standard Western comics
practice) is the oldest and most learnable system available, and it already distinguishes
exactly the things we need:

- round/oval balloon = ordinary speech; **cloud** = interior monologue; **spiked burst**
  = shout, impact, surprise; **dashed outline** = whisper; rectangular caption box =
  narration; spiky balloon + lightning tail = transmitted speech.
- The tail points at the speaker's mouth and terminates roughly 50–60% of the way
  between balloon and head. An off-panel speaker gets a "squink" — a multi-pointed
  burst at the tail's end.
- Balloon placement dictates reading order; the first speaker's balloon must sit where
  the eye lands first.

**Game emote systems** supply the second half — non-verbal state above tiny sprites:

- **Stardew Valley** overhead emotes: an animated *icon bubble* above an NPC's head
  indicating mood or reaction. **Animal Crossing** "Reactions" (formerly "Emotions") do
  the same, including the bare `...` thought bubble. **The Sims** puts an *icon of the
  object or need* inside a thought cloud. The lesson is consistent: at sprite scale, an
  icon inside a bubble is the readable unit — not text.
- **RimWorld** + the *Interaction Bubbles* mod (Jaxe-Dev/Bubbles) is the closest analogue
  to our problem — many pawns, constant social interactions, text that otherwise only
  exists in a log. Its design notes two things we adopt and one we deliberately invert:
  bubbles fade after a short time; fading is tied to game time so pausing halts it;
  hovering makes them transparent and click-through. We **invert** the "tied to game
  time" rule — see §6, lifetime.

**Label-placement literature** (temporal map labelling; radial contour labelling with
straight leaders) gives the crowd answer: labels must never overlap; the standard
remedies are priority-based culling, deterministic angular/vertical ordering, and
scale-then-hide. We use priority ordering + vertical lifting + demotion, and we never
scale text down (§7).

**What fits a world of 22×48 sprites where many things happen at once:** shape is the
primary channel (it survives downscaling), colour is the coarse secondary channel, icon
is the fine channel, and text is a luxury that only exists above a zoom threshold.

---

## 2. The central constraint: real messages are 385 characters

Measured across **3,363 real `speak`/`self_talk` `payload.message` strings** from
`runs/*.jsonl`, `runs/scenario/*.jsonl` and `runs/seed-*/events.jsonl`:

| | chars |
|---|---|
| min | 32 |
| p10 | 211 |
| **median** | **385** |
| mean | 395 |
| p90 | 580 |
| max | 1153 |

**93.8%** of real messages exceed the old bubble's ~192-character effective ceiling and
were hard-truncated. Longer messages contain paragraph breaks and embedded quoted
dialogue, all of which the old `\s+` wrap silently collapsed.

> **SUPERSEDED 2026-08-21 — OWNER DECISION: "They should show full messages."**
>
> The excerpt-plus-fullness-bar answer below is **withdrawn**. A bubble now carries the
> **whole payload**, always. Nothing truncates, and no ellipsis is ever appended. What
> the fullness bar used to report — the size of a being's inner life — is now carried by
> the bubble itself, because the bubble *is* that size. `layoutExcerpt` is replaced by
> `layoutMessage`, and the fullness bar is gone from the grammar.
>
> Three rules make a whole message fit a world of 22x48 sprites:
>
> 1. **The measure grows with the message.** Columns are
>    `clamp(round(sqrt(1.5 x 2.2 x total)), minColumns, maxColumns)` — a target 2.2:1
>    text block, so a remark is a remark and a confession is a paragraph. Bands per kind
>    keep the grammar's ordering: thought 14-38, whisper 16-40, speech 18-44. Past the
>    band the block stops widening and grows downward.
> 2. **The type steps down a ladder to a FLOOR, then stops.** Blit scale is
>    `min(bubbleScale(zoom), 4 | 3 | 2 by length at 110 / 260 chars)`. The LENGTH
>    ladder's floor is **2** — a 10x16 px glyph cell: past it a long message grows the
>    BUBBLE rather than shrinking its own type, so a confession is never typed smaller
>    than the remark beside it. The CAMERA is not bound by that floor; zooming out takes
>    every bubble to blit scale 1, the 5x8 authored cell, which is both the smallest
>    the face reads at and the smallest `bubbleScale` can produce.
> 3. **Only a viewport too small for the result may go below the floor**, one scale step
>    at a time and never below the authored 1x face. That is the narrow/phone branch,
>    and it is the honest trade: a bubble taller than the screen is less readable than a
>    small one that fits.
>
> **The addressee tag.** Directed speech opens with a **bracketed `[to <name>]`** line on
> its own row, derived from the event payload's `target_id` (never from prose), resolved
> to a public display name at the one choke point both bubble paths share
> (`ProductionSceneCommandResolver.effectCommands`) and composed by `addresseeTag`. A
> being with no public-safe name gets **no tag** rather than a raw id. Undirected speech
> and private self-talk carry no tag at all.
>
> Two things make it read as a tag ABOUT the line rather than as the line's opening
> words (Safi, 2026-08-26: *"color code the and use [] for the [to dick] etc messages"*).
> **The brackets** are structure, so an over-long name loses NAME characters and the pair
> still closes; `MAX_TAG_CHARS` is 26 rather than 24 precisely so `[to ` + `]` costs the
> name nothing against the bare form's `to `. **`TAG_INK` (`#5f7285`)** is the palette's
> one cool accent — every other colour the overlay owns is warm, so cool slate on warm
> vellum is the only hue in the set that reads as a label instead of as faded speech. It
> was chosen by eye at the type FLOOR (blit scale 2, which the default zoom of 2 already
> produces, so the floor is the common case): speech's own `world` accent is ~3.2:1 on
> vellum and reads as washed-out ink, `exchange` is dimmer, `dwell` green sinks into the
> terrain, `harm` red shouts violence over a civil sentence, and `bond` rose would paint
> every directed line — hostile ones included — in the mating family's colour. Borrowing
> the `body` family's hue costs nothing legible: family colour is only ever worn by a
> mark's post/bar/glyph or a burst, never by a bubble.
>
> The tag keeps its **own line**, above the message and outside the message's own wrap.
> That is what makes it structurally impossible to break between `[` and `]`, and — since
> the box is sized to hold tag and message together — impossible to orphan from the words
> it belongs to.
>
> **In-message references.** Every being the message actually *says* is bracketed and
> drawn in the same `TAG_INK` (Safi, 2026-08-26: *"all references within the bubble …
> within the block braces and then, with a different color, it should name that
> reference"*). `"Joe, Dick, Allen—it is as I feared. Both the East and West are
> incredibly sparse."` draws as `[Joe], [Dick], [Allen]—…` with `East` and `West` left
> plain. The bubble therefore carries **one** reference colour, not two.
>
> What makes a word a being is the **frame's roster** (`markBeingReferences`), never a
> capitalised-word heuristic — which is exactly what would have painted the two regions
> in that sentence. The roster is the same `safePublicCopy`-scrubbed name map the tag
> uses, handed to every bubble at the same choke point, so an id or an unsafe name can
> never be bracketed and an unknown name is simply left as plain type. Matching is
> **case-sensitive** (a being called `Will` must not paint every "will"), **whole-word**
> (`Maeve` is never `[Mae]ve`; `Joe's` is `[Joe]'s` — punctuation and the possessive stay
> outside), **longest-first and non-overlapping** (`Allen` beats the `Al` that opens it),
> and floored at two characters so a one-letter name cannot paint every `I` in the world.
> The speaker's own name is bracketed too — one uniform rule, and a self-mention is still
> a reference. Self-talk gets references but still no `to` tag: it is addressed to nobody.
>
> Colour runs are free here because the font is **fixed-advance**: a run's pen x is its
> character offset, so `layoutMessage` wraps tokens whose length already counts the
> brackets, and a bracketed name is an atomic token that cannot split across two lines.
> The 5–7s lifetime band is deliberately **not** affected: `MessageLayout.total` stays the
> whitespace-normalised count of the WORDS SAID, because `shared/speechLifetime.ts` holds
> that number in mechanical lockstep with the scene the being plays while speaking.
> Brackets are chrome, and chrome has never driven either clock.
>
> **Placement.** The crowd solver additionally treats the speaker's and the addressee's
> own 22x46 bodies as blockers for that bubble alone, lifts up to 14 rungs (a text
> bubble is tall; five 8px lifts cannot clear a body), and then **translates** the chosen
> rect back inside the safe frame — never crops it. Priority order: on the screen and
> whole > clear of the two bodies > pinned to its crown. A bubble whose owner is off
> screen is not dragged into view, because words must belong to somebody.
>
> **Reading budget.** `clamp(1200 + 70 x chars, 2600, 30000)` ms. The old 9s ceiling
> paid for 111 characters and would have taken a median line away two-thirds unread.

## 3. The grammar — five silhouettes

![Three silhouettes](mockups/bubbles/02-three-silhouettes-2x.png)

Shape is the primary channel because it is the only one that survives downscaling. All
geometry below is authored in **world pixels at 1x** and blitted at an integer scale.

| # | Kind | Silhouette | Connector | Used for |
|---|---|---|---|---|
| 1 | **Speech** | rounded balloon, 2px pixel-stepped corners, solid 1px ink outline, vellum fill, light top bevel | **fat tapering tail**, 15px base × 10px, filled with the speaker's identity hue | `speak` (LOCAL / broadcast) |
| 2 | **Whisper** | same balloon, **dashed** outline (2-on-3), narrower | same tail, plus a **thread** to the addressee | `speak` (TARGETED) |
| 3 | **Thought** | **scalloped cloud** (inscribed ellipse ∪ deterministic bumps), dashed outline, 88% opacity, smallest of the three | **three detached shrinking puffs**, no tail, no anchor stud | `self_talk` |
| 4 | **Action mark** | **tapered banner** — flat top and bottom, both ends chamfered to a point at mid-height. Deliberately neither balloon nor rectangle; it reads as a planted sign | **rigid 3px post + 9px foot bar** — mechanical, unmistakably not a mouth | all 22 action events |
| 5 | **Impact burst** | **spiked star**, 11 deterministic spikes, no bevel | **none** — it sits *on* the thing it happened to | `attack`, `home_breached`, `home_collapsed`, `agent_died`, `agent_born` |

The connector alone identifies the kind before a single word is read. This is the direct
fix for the rejected version, whose 5px-tall, 1–3px-wide stepped tail disappeared at real
zoom: our tail is **3× taller, 5× wider at the base, filled with a contrasting identity
colour, and terminated by a hard 3px anchor stud pinned on the head**.

### The six families

![Grammar sheet](mockups/bubbles/09-grammar-sheet.png)

Colour is the coarse channel; the glyph is the fine one. A viewer never learns 28 event
types — they learn four shapes and six colours.

| Family | Accent | Glyphs |
|---|---|---|
| **exchange** | `#b8801f` ochre | give · gather · hoard |
| **bond** | `#a35f69` clay-rose | propose · refuse · lapse · birth |
| **harm** | `#9c3b26` rust | strike · breach · thieve · fell · decay |
| **dwell** | `#57783f` moss | build · hearth · join · depart · claim · scavenge · collapse |
| **body** | `#5f7285` slate | halt · rise |
| **world** | `#8a8270` bone-grey | outward · inward · dawn |

Glyphs are **9×9 1-bit** — the readable unit at 1x. `join`/`depart` and
`scavenge`/`collapse` are deliberate mirror pairs; `outward`/`inward` are double
chevrons, distinct from the single chevron + doorway of `join`/`depart`.

### Type

A hand-authored **5×8 1-bit pixel font**; advance 6px, line height 9px. Not a system
font: at these sizes hinting is unreliable and a system font instantly reads as "UI"
rather than "world". The fixed advance also means layout is **deterministic and identical
in jsdom and in a browser** — which preserves the existing `wrapBubbleText` constraint of
never calling `measureText`.

---

## 4. Inventions beyond the brief

### 4.1 The gather — a bubble has two phases

![Gather then resolve](mockups/bubbles/03-gather-then-resolve-2x.png)

The owner's complaint was that bubbles had **"no correlation to whether the thought is
even being generated."** The answer is that a bubble is not an object that appears; it is
a **gesture with a beginning**.

Every bubble opens as a small dotted **gather-cloud** whose three dots fill left to right,
then **resolves** — hardening into a balloon (it spoke), staying a cloud and filling with
text (it thought), or snapping into a banner (it acted).

This requires **no new simulation data**. The choreography layer already gives every
presented event an *enter* window before its *consequence* phase. The gather occupies the
enter window; the resolved form occupies the consequence. You watch the being produce
something rather than finding a box over its head.

### 4.2 The thread — who it was aimed at

![Aim and refusal](mockups/bubbles/04-aim-and-refusal-2x.png)

A 1px dotted ink line runs from the actor's bubble to a **receiver cap** — a chevron in
ink/vellum/accent that sits just above whoever the event was aimed at. "Who it happened
to" never needs a label.

**A refusal is a bond that stops.** For `mating_rejected` the thread halts at 55% and is
struck through by two hard cut-ticks in the family accent, and the refusal answers back
from the other side. A gift and a refusal are opposite gestures, not the same particle
with a different word attached — which is the current state per
`EVENT_PERFORMANCE_MATRIX.md` §A5 ("a proposal, a punch, and a stolen-materials payout
are visually the same particle").

This also **closes the whisper/broadcast gap** the matrix flags in §A3: a whisper is a
dashed balloon *with* a thread; a broadcast is a solid balloon *without* one.

### 4.3 Residue pips — for the viewer who looked away

When a bubble expires it does not vanish. It collapses into a **pip**: a 13×13 stud with
the family colour as its field and the glyph in vellum, drawn one integer scale step
*below* the live chrome because residue is secondary information. Up to **3** pips queue
at a being's shoulder, oldest first, fading over 6s.

A viewer scanning a crowd therefore sees not only what is happening now, but the last few
things that happened to each being. It turns instantaneous events into a readable local
history, and it is derived purely from the event stream.

### 4.4 Identity hue

Each being gets a stable hue from a hash of its **id**, drawn from 8 palette-safe values
chosen to read against both moss grass (`#b4bc6c`) and sand (`#d4bc94`) — no greens,
nothing that sinks into terrain. It colours exactly two things: the **speech tail** and
the receiver cap's core.

This makes bubbles attributable at a glance without nameplates, and it strengthens the
connector into a solid contrasting wedge. It is derived from the id alone and **claims
nothing about who the being is**. The beings author their own identities in text; if a
persona-derived hue is ever wanted, §9 names the seam — but it must come from real data
or not at all.

### 4.5 Significance tiers — a death must not look like a greeting

![Knell](mockups/bubbles/06-knell-birth-and-death-2x.png)

| Tier | Events | Treatment |
|---|---|---|
| **MURMUR** | `self_talk`, `agent_decayed`, region movement | small, dashed or light, shortest lifetime, first to demote |
| **BEAT** | most actions | standard banner |
| **STRIKE** | `attack`, `home_breached`, `home_thieved`, `mating_rejected` | burst silhouette, 2px outline, longer hold |
| **KNELL** | `agent_died`, `agent_born`, `home_collapsed` | largest, **inverted field**, longest lifetime, never demoted, never stacked away |

Restraint is what makes the knell land. Death is not a loud red explosion; it is the one
moment the world goes to **ink** — a black starburst with a bone glyph over a fallen
body. Birth is its mirror in light. These are the **only two inversions in the entire
vocabulary**, which is precisely why they carry weight.

---

## 5. Anchoring

- The placement ledger's agent point is **feet**. The connector tip anchors at
  `feet − 50` world px, i.e. just above the top of the sprite frame (`feet − 46`), so a
  post or tail *touches the crown of the head* instead of planting into the hair. The
  existing `HEAD_EFFECT_OFFSET_Y = 40` puts the anchor mid-hair; see §9.
- Anchor stud: a hard 3px ink chip at the connector tip on speech/whisper/mark. A thought
  has no stud — it is the one kind with no physical link to the world.
- Tail lean is clamped to ±14 world px toward the addressee.
- Bursts anchor at the **centre of the affected thing** — the victim's torso, the
  breached wall — never above a head.
- `home_*` marks anchor on the **home**, not the actor, when the home is the subject
  (`home_started_hoarding`, `home_colonized`, `home_collapsed`).

---

## 6. Sizing, wrapping, lifetime

```
font              5×8, advance 6, line height 9      (world px)
padding           speech/whisper 5×4, thought 8×7
columns/line      chosen per message; speech 18-44, whisper 16-40, thought 14-38
max lines         none — the WHOLE message (2026-08-21; see §2)
blit scale        min(round(zoom), lengthLadder) floored at 2, or lower only to fit
```

Thought is deliberately the *smallest and quietest* of the three: narrower, dashed, 88%
opacity, fewer words. A private thought is overheard, not announced.

**Lifetime is wall-clock and is NOT divided by the simulation speed multiplier:**

```
lifetime_ms = clamp(1200 + 70 × visibleChars, 2600, 30000)   (was 9000 before 2026-08-21)
pip residue = 6000ms fade, max 3 per being
```

Rationale — and this is where we deliberately invert RimWorld's convention: text you
cannot finish reading is worse than a world that runs slightly ahead of its captions. At
2x speed the sim outpaces the bubbles; the **pips** carry the tail of memory so nothing is
lost. Tying fade to sim time would make every bubble at 2x unreadable.

One live bubble per being; a new event replaces the old (the old one demotes to a pip
rather than disappearing).

---

## 7. Crowds

![Crowd](mockups/bubbles/07-crowd-seven-beings-2x.png)

Seven beings, seven live marks, zero collisions. Placement is a deterministic solver, not
physics:

1. Candidate rect = anchor, snapped to an **8px screen lattice**.
2. Placement order: **tier descending, then event sequence ascending.** No float
   tie-breaks — identical input produces identical layout, which replay requires.
3. On collision: **lift one row (8px)** — up to 5 rows for a mark, 14 for a text bubble,
   which is tall enough to need the extra rungs to clear a 46px body.
4. Still colliding: **shift laterally 12px** away from the nearest neighbouring being.
5. Still colliding: a **MARK demotes to its glyph stud** (its meaning is the glyph; the
   banner is a label). A **TEXT bubble never demotes** — it is drawn where it belongs,
   overlapping, and the frame is counted in `EnvironmentDiagnostics.collidedBubbles`
   (Safi, 2026-08-27: *"Overlap is tolerable but at first the system itself should keep
   them apart... If that even fails then it's the fallback not a first choice."*). Never
   shrink text *for crowding* — readability beats completeness. (A message's own LENGTH
   does step the type down a bounded ladder to a floor; see §2. Crowding never does.)
6. **No budget of live text bubbles.** A `CROWD_TEXT_BUDGET` of 6 used to demote every
   bubble past the sixth; a message hidden to tidy the screen is a message unread. The
   pool capacity and the 5-7s lifetime band are what bound how many are live at once.
   KNELL tier is never demoted; among marks, MURMUR demotes first.
7. **Prevention comes before all of this**, upstream: `conversationStaging` stands two
   conversing beings `CONVERSATION_BUBBLE_CLEARANCE_PX` apart — one whole speech-bubble
   width, measured from the drawn grammar — so the pair the viewer is actually reading
   rarely reaches step 3 at all.

This generalises the existing greedy sort-by-x-then-sequence, lift-until-clear helper in
`EnvironmentSystem.drawSpeechBubbles()`.

---

## 8. The zoom ladder and reduced motion

![Zoom ladder](mockups/bubbles/08-zoom-ladder-0p5x-1x-2x-4x.png)

Camera range is `MIN_ZOOM 0.5` → `MAX_ZOOM 4`.

- **Chrome is authored at 1x and blitted at `bubbleScale = clamp(round(zoom), 1, 4)`.**
  It is therefore *never* sub-pixel at any camera zoom — no blurred pixel art, no tail
  eroding to nothing. This is the structural fix for the rejected version's disappearing
  connector.
- **A message keeps its words at every zoom** (Safi, 2026-08-27: *"on zooming out do not
  show `""` show full bubbles"*, then *"scale down with the world, just make them small
  but still readable"*). Zooming out shrinks a bubble with the world until blit scale
  reaches 1 and then holds it there — `bubbleScale` clamps to an integer 1, so that is
  the smallest a bubble can be drawn at all. The 5x8 face reads at that size because the
  stage sets `image-rendering: pixelated`, so a CSS-px canvas is nearest-upscaled to the
  device grid rather than blurred.
- **Below zoom 1.5 a MARK drops its banner** and keeps its **glyph stud on a short 4px
  stem**. A mark's meaning is its verb glyph and the banner is a label, so a wide view of
  the world reads as a field of coloured intent rather than a wall of banners larger than
  the beings under them. The banner returns on the way back in.
- **Nothing is ever hidden to tidy the screen.** There is no cap on how many messages may
  be up. Crowding is answered by placement — the solver lifts and shifts, and conversational
  staging stands a talking pair a bubble's width apart before they ever speak — and when
  placement genuinely fails the bubble is drawn overlapping and counted in
  `EnvironmentDiagnostics.collidedBubbles`. Only a MARK still demotes under crowding.
- Threads, caps and pips persist at all zooms; they are the cheapest and most
  downscale-robust parts of the language.

**Reduced motion:** the gather opens already resolved (no dot animation); no pulse, blink
or typewriter; threads render as a solid line with a single arrowhead instead of marching
dots; lifetimes extend by 30%. Nothing is *removed* — reduced motion means less animation,
not less information. (This matches the contract already asserted in
`lifecycleMovementCommunicationResource.test.ts:382`.)

---

## 9. The 28-event mapping

This table is the **exhaustiveness oracle**. It must exist in code as
`Record<PresentedEventType, OverlayMappingEntry>` so a new canonical event fails to
compile until mapped, plus a runtime test iterating `EVENT_VISUAL_EVENT_TYPES` from
`frontend/src/events/eventVisualCatalog.ts` — mirroring the proven
`assertCompleteChoreographyRegistry` pattern in
`presentation/choreography/registry.ts:106`. **The prior attempt designed this table on
paper and never wrote it as code; that gap is why nothing currently forces coverage.**

`A` = action mark, `S` = speech, `T` = thought, `B` = burst, `→` = thread + receiver cap.

| # | Event | Kind | Glyph | Family | Tier | Anchor / notes |
|---|---|---|---|---|---|---|
| 1 | `agent_born` | **B** + A on acceptor | `birth` | bond | KNELL | burst at the newborn; light field |
| 2 | `agent_died` | **B** inverted + A on killer | `fell` | harm | KNELL | burst on the body; ink field, bone glyph |
| 3 | `agent_decayed` | A | `decay` | body | MURMUR | at the corpse, just before removal |
| 4 | `agent_paralyzed` | A | `halt` | body | BEAT | victim; `→` from attacker only when `trigger==="attack"` |
| 5 | `agent_recovered` | A + `→` | `rise` / `give` | body / exchange | BEAT | `rise` on recipient, `give` on giver |
| 6 | `agent_left_region` | A | `outward` | world | MURMUR | at the departure gate |
| 7 | `agent_entered_region` | A | `inward` | world | MURMUR | at the arrival gate |
| 8 | `speak` (LOCAL) | **S** solid | — | — | MURMUR | no thread — a broadcast is addressed to no one |
| 9 | `speak` (TARGETED) | **S** dashed + `→` | — | — | MURMUR | **whisper ≠ broadcast**, closes matrix §A3 gap |
| 10 | `self_talk` | **T** | — | — | MURMUR | text selection-gated; see §10 open question |
| 11 | `resource_changed` | A + micro | `gather` | exchange | BEAT | at the resource anchor tile |
| 12 | `resource_transferred` | A + micro + `→` | `give` | exchange | BEAT | micro = amount |
| 13 | `agent_started_hoarding` | A + micro | `hoard` | exchange | BEAT | micro = new total |
| 14 | `mating_initiated` | A + `→` | `propose` | bond | BEAT | |
| 15 | `mating_rejected` | A + **severed** `→` | `refuse` | bond | STRIKE | refusal answers from the other side |
| 16 | `mating_proposal_invalidated` | A | `lapse` | bond | MURMUR | initiator only; micro `VOID` |
| 17 | `mating_proposal_timeout` | A | `lapse` | bond | MURMUR | initiator only; micro `LAPSED` |
| 18 | `attack` | A + micro + **B** + `→` | `strike` | harm | STRIKE | mark+cost on attacker, burst on victim |
| 19 | `home_built` | A | `build` | dwell | BEAT | builder; stud on the home |
| 20 | `hearth_used` | A | `hearth` | dwell | BEAT | user, at the door |
| 21 | `home_joined` | A + `→`(home) | `join` | dwell | BEAT | joiner |
| 22 | `home_left` | A + `→`(home) | `depart` | dwell | BEAT | leaver |
| 23 | `home_started_hoarding` | A | `hoard` | dwell | BEAT | anchored on the **home** |
| 24 | `home_collapsed` | **B** inverted | `collapse` | dwell | KNELL | at the home; no owner required present |
| 25 | `home_breached` | A + **B** | `breach` | harm | STRIKE | mark on striker, burst on the **wall** |
| 26 | `home_thieved` | A + micro + one `→` **per recipient** | `thieve` | harm | STRIKE | each recipient's exact share as their micro |
| 27 | `home_colonized` | A | `claim` | dwell | BEAT | anchored on the **home** |
| 28 | `ruins_scavenged` | A + micro | `scavenge` | dwell | BEAT | scavenger |
| — | `simulation_started` | A | `dawn` | world | BEAT | region centre, no owner |

Rows 19–28 are the **10 home/contest events that currently have zero overlay wiring** —
more than a third of the vocabulary, and half the world's drama. They are not an
afterthought here; `dwell` is the largest glyph family.

---

## 10. Implementation note — exact seams

Read `.superpowers/sdd/legibility-overlay-report.md` first. Its conclusion holds: **the
plumbing is sound, the drawing is not.** The effect-pool architecture (separate pools per
primitive, all exclusion-exempt, drawn in the "air" pass) should survive wholesale.

**Replace (~150 lines):**
- `frontend/src/renderer2d/production/environment/EnvironmentSystem.ts`
  — `drawSpeechBubble()` (≈1254-1309), `bubbleBoxSize()`, `BUBBLE_PALETTE` /
  `BUBBLE_FONT` (≈282-320). This is the entirety of what failed. Add the pixel-font
  table, the mask painters (rounded-rect / cloud / banner / burst), and the pip, cap and
  thread painters.
- Keep `emitBubble()` (≈575-602), the pool lifecycle, and the stacking helper in
  `drawSpeechBubbles()` (≈789-829) — generalise the latter per §7.
- Keep `wrapBubbleText()`'s deterministic fixed-advance contract (≈1199-1241); replace its
  body with §2's sentence-bounded excerpt + fullness metadata (`shown`, `total`).

**Constants:**
- `HEAD_EFFECT_OFFSET_Y = 40` (`EnvironmentSystem.ts:213`) → connector tips want **50**.
  Prefer adding `CONNECTOR_TIP_OFFSET_Y = 50` rather than moving the shared constant,
  since other head effects depend on 40.
- `TILE_SIZE = 32` (`renderer2d/map/regionMap.ts:4`); `MIN_ZOOM 0.5` / `MAX_ZOOM 4`
  (`renderer2d/camera/Camera2D.ts:8-9`); `worldToScreen` at `Camera2D.ts:534-556`.

**Integer-scale blitting — the one architectural change.** Today the whole scene graph
draws inside a single `context.setTransform(zoom, 0, 0, zoom, …)`
(`CanvasPresentationRenderer.ts` ≈1780-1818), so bubble chrome is physically scaled by a
continuous zoom and goes sub-pixel. The overlay pass should instead **reset the transform,
position via `worldToScreen`, and blit pre-rendered 1x chrome at
`clamp(round(zoom), 1, 4)`**. Positions stay exact; chrome stays crisp.

**Contracts:**
- `frontend/src/presentation/contracts.ts` — `EffectVisualIntent.kind` currently has
  `speech-bubble` (with `variant: spoken|thought|whisper`), `bond-token`, `flying-item`,
  `impact`, `carried-badge`, `structure-beat`. Recommend collapsing the action-ish kinds
  into one `event-mark` carrying `{ glyph, family, tier, micro?, targetId? }`, keeping
  `speech-bubble` for kinds 1–3 and reusing `impact` for the burst. Fewer kinds, one
  resolver branch, one draw path.
- `ProductionSceneCommandResolver.ts` — `effectCommands()` ≈383-512. **SUPERSEDED
  2026-07-25:** the thought-privacy gate that used to live here has been REMOVED by
  owner decision (see §11 Q1 below and `.superpowers/sdd/progress.md` § "SELF_TALK
  RENDERS OPENLY"). Do not restore it. The resolve-time-vs-draw-time lesson in
  `.superpowers/sdd/bubble-fix-report.md` still stands for any FUTURE selection-gated
  content — gate at draw time, never at resolve time — but self_talk is no longer gated.
- `ProductionSceneGraph.ts` — `draw()` ≈1570-1578; overlay stays in the `"air"` pass,
  after actors and front-homes.

**The unwired third:** `presentation/choreography/homeContestSystem.ts` — rows 19–28.
Largest single block of work.

**Exhaustiveness oracle:** new `eventLegibilityMap.ts` per §9. A new sim event must fail
a test until it is mapped. This is the loop-ending mechanism and it does not exist today.

**Full text:** unchanged — `app/observer2d/DialogueNow.tsx` keeps the complete message.
The bubble is the excerpt; the panel is the record.

---

## 11. Open questions for Safi

1. ~~**Contentless thinking marker for unselected beings.**~~ **DECIDED 2026-07-25 —
   thoughts render OPENLY, with their text, for every being; no selection gating.**
   Safi chose this over the proposed textless middle option. Rationale of record:
   `ScopeType.PRIVATE` means other *beings* never perceive the thought (it is routed to
   zero inboxes); the viewer is not a being, so simulation privacy is untouched while
   viewer visibility is granted. Verified after implementation: sim routing unchanged,
   all six presentation consumers consistent, no other content lost a gate.
2. **Persona-derived hue.** Identity hue is currently an id hash. Beings author their own
   identity summaries; if you want their bubbles tinted by something they actually wrote,
   that needs a real data path. I will not fabricate one.
3. **Nameplates.** Not drawn by default — the identity-coloured tail carries attribution.
   A name chip on the first bubble per being per window is a cheap addition if you want it.

---

## 12. Mockup index

All at native resolution, real assets, verbatim payload text. `docs/frontend/mockups/bubbles/`:

| File | Shows |
|---|---|
| `00-full-deck-2x.png` | the whole deck as one page |
| `01-hero-one-moment-2x.png` | six beings, five simultaneous events, no collisions |
| `02-three-silhouettes-2x.png` | speech vs thought vs action side by side |
| `03-gather-then-resolve-2x.png` | the two-phase bubble |
| `04-aim-and-refusal-2x.png` | thread + receiver cap; severed thread |
| `05-harm-burst-2x.png` | strike on a being, breach on a wall |
| `06-knell-birth-and-death-2x.png` | the only two inversions |
| `07-crowd-seven-beings-2x.png` | seven live marks, zero collisions, residue pips |
| `08-zoom-ladder-0p5x-1x-2x-4x.png` | the blit-scale ladder (predates the 2026-08-27 rule that text survives every zoom) |
| `09-grammar-sheet.png` | five silhouettes, six families, all glyphs |
| `10-hero-1x.png` / `11-hero-4x.png` | the hero scene at the low and high extremes |

Source lab (not wired into the app, scratchpad only): `bubble-lab/{font,bubbles,assets}.js`,
`lab.html`, `build.py`, `shot.py`.
