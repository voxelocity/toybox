# Soccer Rocket

Rocket-powered car soccer in the browser: 120 Hz physics modelled on the
documented car-soccer physics, bots, full match flow, replays,
controller and touch support, a low detail mode, and synthesised audio.

## Run it

Needs [Node.js](https://nodejs.org) 18+. There are no packages to install for playing.

```bat
cd C:\Users\shark\Documents\Projects\SoccerRocket
npm start
```

Open http://localhost:5173. The server also prints a LAN address so you can play on a
phone or tablet on the same Wi-Fi.

### If it doesn't start

- **Stuck on the loading screen:** press F12 and look at the *Console* tab. The last red
  line says what failed. A reload with Ctrl+F5 makes sure the browser isn't running an
  older copy of the scripts.
- **"Compiling shaders…" takes a while:** that's the graphics driver building the
  shaders. Windows can need 10–30 s on the first run. The next starts are faster because
  the browser caches the result. `?q=low` builds far fewer shaders.
- **No sound:** browsers start audio only after your first click or key press. Sounds
  are synthesised in the background, so the crowd and explosions can come in a few
  seconds after the menu appears.

### Getting this folder onto your PC

The code lives in the `SoccerRocket/` folder of the `claude/clever-mccarthy-p84tr5` branch.
Copy its contents into your project folder and leave your existing `assets` folder where it is:

```bat
git clone -b claude/clever-mccarthy-p84tr5 https://github.com/voxelocity/toybox %TEMP%\toybox
xcopy /E /I /Y %TEMP%\toybox\SoccerRocket C:\Users\shark\Documents\Projects\SoccerRocket
```

## Your car and ball models

The game uses your own models from the project's `assets/` folder (next to `server.js`).
These files are not committed to git.

- `Fennec.fbx`: the car. Every player and bot drives it.
- `rocket_ball.fbx`: the ball. Its texture is embedded.
- Textures: put them anywhere in `assets/`. They are matched by file name, whatever
  absolute path was baked into the FBX. Colour maps are matched to materials by name.
  A file whose name contains `chassis` goes on "Fennec Chassis", and one containing
  `alpha`, `rim` or `wheel` goes on "Alpha Rim". Normal maps are loaded from the names
  stored in the FBX (`Chassis_Grain_N.png`, `Alpha_N.png`, `NormalMap.png`).
  Swizzled normal maps, with X stored in alpha, are converted automatically.
- Shadow textures: any image whose name contains `shadow` is drawn under the car,
  and if the name also contains `ball` it is drawn under the ball.

Supported formats: `.fbx`, `.glb`, `.gltf` (including Draco and meshopt) and `.obj`.
The browser console prints an `[assets]` line listing which texture went where.

If a guess is wrong, create `assets/soccerrocket.json`:

```json
{
  "car": "Fennec.fbx",
  "ball": "rocket_ball.fbx",
  "textures": {
    "Fennec Chassis": "Chassis_D.png",
    "Alpha Rim": "Alpha_D.png",
    "Dieci Tread": "Tread_D.png"
  },
  "carShadow": "Fennec_Shadow.png",
  "ballShadow": "Ball_Shadow.png",
  "paintMaterials": ["Paint", "Fennec - Body"],
  "fit": "hitbox",
  "scale": 1.0,
  "offset": [0, 0, 0]
}
```

`fit: "hitbox"` (the default) scales the model uniformly so the body spans the Octane-class
hitbox the way it does in game. The front bumper sits about 3 uu ahead of the hitbox front
and the tail is flush with its rear. `fit: "wheels"` instead keeps the model's native
wheelbase on the physics wheels. `scale` and `offset` (uu: forward, up, left) are for
fine-tuning.

Press **H** in Free Play, or turn on *Settings › Video › Show car hitboxes*, to see the
physics hitbox and wheels drawn over the car.

## Physics

Units are Unreal units (1 uu = 1 cm), the simulation runs at 120 Hz, and z points up. The
model follows the published RocketSim / RLBot research. `npm test` checks it against
documented values:

| | value |
|---|---|
| Hitbox (Octane class, used by the Fennec) | 118.0074 × 84.1994 × 36.1591, offset (13.8757, 0, 20.7553) |
| Wheels front / back | radius 12.5 / 15, rest 38.755 / 37.055, ray reach rest + radius − 2.5 |
| Suspension | stiffness 500, damping 25 / 40, force scale 35.75 / 54.265 |
| Rest | z ≈ 17, about 0.6° nose down |
| Throttle | 1600 uu/s² at 0 falling to 0 at 1410 uu/s; brake 3500, coast 525 |
| Boost | +991.7 uu/s² ground, 1058.3 air, 33.3 per second, max speed 2300 |
| Jump | 291.7 instant + 1458.3 uu/s² for up to 0.2 s (~235 uu full jump, ~475 double) |
| Dodge | 500 uu/s impulse (speed-scaled side/back), 0.65 s torque, z-damping, flip cancels |
| Air control | torque (pitch 130, yaw 95, roll 400) × 0.0959, damping 30/20/50, max 5.5 rad/s |
| Turning | steer angle curve calibrated to the measured curvature table (0.00398 @500 … 0.00088 @2300) |
| Ball | r 91.25, mass 1/6 car, restitution 0.6, friction 0.35, drag 3%/s, max 6000 uu/s |
| Hits | rigid impulse plus the extra "hit" impulse curve (0.65 → 0.30) |
| Demos & bumps | supersonic (≥2200) front-bumper hits demolish; bump velocity curves for others |

The arena is the standard 8192 × 10240 × 2044 field with 45° corners, 256 uu curved
transitions and 1786 × 642.8 × 880 goals. The same geometry drives both collisions and
rendering.

## Controls

| | Keyboard / mouse | Controller | Touch |
|---|---|---|---|
| Drive | W / S | RT / LT | joystick up/down |
| Steer / aim | A / D (W/S pitch in air) | left stick | joystick |
| Jump / dodge | Space, right mouse | A | JUMP |
| Boost | Shift, left mouse | B | BOOST |
| Powerslide / air roll | Ctrl, C | X | DRIFT |
| Air roll left/right | Q / E | LB / RB | |
| Ball cam | F, middle mouse | Y | CAM |
| Scoreboard / pause | Tab / Esc | Back / Start | II |

Keyboard bindings can be changed in Settings › Controls.

## Graphics

Quality is chosen automatically on first run and drops a level by itself if the frame
rate falls. You can also force it with `?q=low|medium|high|ultra`.

- **Low** (phones, older PCs): no shadow maps, flat grass, no bloom, fewer particles,
  simple materials, and blob shadows.
- **Medium / High / Ultra**: sun shadows up to 4K, 8–26 layers of shell grass that
  sways in the wind and flattens under cars, bloom, SMAA, an animated crowd and
  full particles.

## Audio

Every sound is synthesised in a Web Worker in the background while the menu is up;
there are no sample files.

- **Engine:** combustion pulses through exhaust resonators, as three loops crossfaded by
  revs, with Doppler shift for other cars.
- **Boost:** turbulent noise with crackle.
- **Ball hits:** modal synthesis.
- **Explosions:** layered blasts with debris.
- **Crowd:** dozens of formant "voices" plus granular applause.
- **Reverb:** a stadium convolution reverb.

To render them to WAV for review, run `node tools/audio-preview.mjs`.

## Development

```bash
npm install                    # dev tools only: three (for vendoring), esbuild, playwright
npm test                       # physics checks
node tests/bots.mjs 3 pro 2    # headless bot match
node tools/shot.mjs out.png "?q=high" 1280 720 4000 "app.startFreeplay()"
node tools/calibrate-steer.mjs # re-derive the steering curve
node tools/vendor-three.mjs    # refresh public/vendor/three
```

Credits: three.js (MIT). Sky HDRI "Kloofendal 48d Partly Cloudy (Pure Sky)" from Poly Haven (CC0).
