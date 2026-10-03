# RocketSim differential tests

Runs the same scripted scenarios through [RocketSim](https://github.com/ZealanL/RocketSim) (MIT, by ZealanL),
the open-source re-implementation of Rocket League's physics, and through SoccerRocket's own physics,
then compares them tick by tick. It needs a C++ toolchain (g++/clang, cmake; ninja optional). The game
itself does not.

```bash
tools/rocketsim/build.sh                       # clone + build RocketSim and rs_oracle, export our arena mesh
node tools/rocketsim/compare.mjs --summary     # one line per scenario
node tools/rocketsim/compare.mjs turn_ flip_   # detail for matching scenarios
node tools/rocketsim/compare.mjs --trace flip_front --obj car0 --every 6
node tools/rocketsim/onestep.mjs hit_2300_offset --obj car0   # single-tick errors, see below
node tools/rocketsim/make-scenarios.mjs        # regenerate scenarios/*.json
```

`onestep.mjs` sets our bodies to RocketSim's state before every tick and compares one simulated tick, so
errors do not accumulate: it shows which tick (a contact, a landing, a wheel touching) our physics handles
differently. Car-internal state (wheel contact, jump and tyre-friction memory) still comes from our own run.

RocketSim normally loads collision meshes dumped from the game. Here `export-cmf.mjs` writes *our* parametric
arena into RocketSim's `.cmf` format instead, so both engines collide with identical geometry.
RocketSim warns that the mesh hash is unknown; that is expected.

Scenario JSON: `ticks`, `every`, optional `ball {pos, vel, angVel}`, and `cars [{team, pos, yaw, pitch, roll`
(or `forward` + `up`)`, vel, angVel, boost, controls: [{tick, throttle, steer, pitch, yaw, roll, jump, boost,
handbrake}]}]`. Controls use RocketSim's conventions (steer/yaw/roll positive = right). `run-js.mjs` converts
them for our left-handed car-local y axis.
