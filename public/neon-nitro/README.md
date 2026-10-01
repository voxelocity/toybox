# Neon Nitro — ネオン・ニトロ

A cel-shaded, neo-Tokyo arcade drift racer for desktop and mobile browsers. It has
Mario Kart–style item boxes, a power-slide that is hard to spin out of, eight-car
Grand Prix cups, and a configure-then-buy tuner garage for three car bodies.

Everything is built at runtime from code: cars, tracks, signage, music and sound
effects. The only files it loads are three OFL fonts, an icon and three.js.

## Run it

```bash
npm install
npm start            # http://localhost:4800/neon-nitro/
```

To host it anywhere as plain files:

```bash
node tools/neon-nitro-build.mjs          # -> dist/neon-nitro (about 2.6 MB)
```

The build copies the game, puts three.js in `vendor/` and rewrites the import
map. The resulting folder runs from any sub-path on any static host.

For sandboxed hosts that only allow scripts from public CDNs, add `--hosted`.
That writes `dist/neon-nitro-hosted`: one page body with the CSS and fonts
inlined, three.js loaded from jsDelivr at the installed version, and `js/`
alongside.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Steer | ← → / A D | left stick, d-pad | left thumb stick (or tilt, in Settings) |
| Gas / brake | ↑ ↓ / W S | A or RT / B or LT | automatic gas, BRAKE button |
| Drift | Space / Shift (hold) | RB (or LT + A) | DRIFT (hold) |
| Use item | E, J, X, Ctrl, Enter | X, Y, LB | ITEM |
| Throw item backwards | hold ↓ while using | stick down | BACK + ITEM |
| Look back | C | click a stick | — |
| Rescue drone | R | Select | — |
| Pause | Esc / P | Start | ❚❚ |

**Drifting.** Hold drift in a corner to power-slide. Physics yaw always follows
the direction of travel. The slide angle is visual only, so a drift cannot turn
into a spin.

While you slide, sparks charge through blue, orange and purple. Release the
drift to fire a mini-turbo. Press drift in mid-air off a ramp for a trick boost.

## Modes and progression

- **Grand Prix.** Two cups of three races each:
  - Neon Cup: Shibuya, Wangan, Haruna
  - Kaiju Cup: Harbor, Akiba, Neo Tokyo Tower

  Each cup runs in three classes: Street, Pro and Legend. Points decide a gold,
  silver or bronze trophy. A Neon Cup trophy unlocks the Kaiju Cup. Trophies in
  every cup of one class unlock the next class.
- **Quick Race.** A single race on any unlocked track.
- **Time Trial.** Solo, three laps, three nitros. Medal par times pay bonuses.
- **Garage & Shop.** Your first car is free. Prize money (¥) buys the other
  bodies and parts. Try anything on the turntable. The cart totals new parts,
  resprays and recolours, and nothing is charged until **BUY & FIT**. Parts you
  have bought stay owned, so swapping back to them is free.

Progress is saved in `localStorage` (`neonNitro.save.v1`). Settings → Reset
save data clears it.

Settings → Graphics chooses Auto, Low, Medium or High. Auto means High on
desktop and Medium on touch devices, and resolution adapts to hold frame rate.
Lower tiers render at lower resolution, drop bloom, and thin out trees and
skyline. They also pull in fog and draw distance.

## Cars

There are three bodies, each with its own base stats:

- **Kaze GT-S**: an E46 / R34 / S15-flavoured sedan.
- **Oni Hauler**: a mini-truck.
- **Raiden RS**: a wedge coupe.

Customisation (all visual changes are real geometry):

- **Front and rear:** six kits per body that rebuild the nose and tail. Examples
  include bosozoku deppa chins, pop-up lamps, takeyari exhaust spears, Dekotora
  chrome, time-attack splitters and venturi tunnels.
- **Side:** skirts, bolt-on widebody, works fenders, side-exit pipes and a
  silhouette GT kit.
- **Aero:** duck lip, GT wing, swan neck, boso tower and roof fins.
- **Wheels:** eight designs, plus rim colour.
- **Stance:** ride height and camber, up to oni-kyan.
- **Paint:** 7 finishes, including pearl, chameleon and neon glow.
- **Livery:** 12 designs, plus vinyl colour.

Parts also nudge stats: top speed, acceleration, handling, drift and weight.

## Tracks

| Track | Setting | Set pieces |
| --- | --- | --- |
| Shibuya Scramble | neon downtown | scramble crossing plaza, rail viaducts, level crossing, tunnel chicane |
| Wangan Midnight | bayside expressway figure-8 | suspension bridge, traffic, toll plaza, construction ramps |
| Haruna Touge | sunset mountain pass | torii tunnel, shrine, lake bridge, gutter hooks, rockfall |
| Kaiju Harbor | stormy container port | crane drops, drawbridge jump, warehouse, a kaiju in the bay |
| Akiba Overdrive | Electric Town | gacha-capsule gauntlet, car-park helix, boom gates, rooftop jump |
| Neo Tokyo Tower | skyways around a megatower | spiral climb, laser gates, maglev, arcology tunnel, ONI-GEAR boss drone |

Items: nitro, triple nitro, oil slick, shuriken, homing missile, daruma bomb,
barrier, EMP, Ryu Rush (dragon autopilot) and Glitch Storm. Glitch Storm hacks every
racer ahead of you: they slow down and wobble, but they don't spin. Rolls are weighted
by race position.

## Code map

```
index.html            app shell + import map
css/                  comic UI (Bangers, Dela Gothic One, Noto Sans JP; OFL)
js/main.js            Game: boot, loop, race flow, payouts, GP
js/core/              input (keys/pad/touch/tilt), save, audio (WebAudio synth), data
js/render/            toon shaders, post (ink outlines, bloom, speed lines), view, signs, showroom
js/geo/builder.js     flat-shaded geometry builder
js/cars/              catalog, hull/cabin lofts, parts, bodies, wheels, liveries, CarModel
js/track/             path, road/edge builder, Track, kit, hazards, scenery, tracks/*.js
js/race/              vehicle physics, AI, items, FX, pads, props, camera, Race
js/ui/                HUD, screens and modals, garage
dev/                  car.html, drive.html, render.html — dev viewers (not shipped by the build)
```

## Tools

- `node tools/neon-nitro-fonts.mjs` re-subsets the two Japanese fonts to the glyphs
  used in the sources. Dela Gothic One is for titles and signs; Noto Sans JP is for
  small labels. Run it after adding Japanese text.
- `node tools/neon-nitro-build.mjs [--hosted] [out]` builds the bundles described above.

## Credits

- Fonts: Bangers, Dela Gothic One and Noto Sans JP, SIL Open Font License (`assets/fonts/OFL.txt`).
- three.js: MIT licence.
- All other art, audio and code are generated procedurally by this project.
