// Simulation constants. Units: uu (1 uu = 1 cm), seconds, radians.
// Values follow the publicly documented car-soccer physics measurements
// (community research on tick rate, accelerations, curves, hitboxes).

export const TICK_RATE = 120;
export const DT = 1 / TICK_RATE;

export const GRAVITY_Z = -650;

// --- Arena -----------------------------------------------------------------
export const ARENA = {
  X: 4096,            // side walls at x = +-X
  Y: 5120,            // back walls at y = +-Y
  Z: 2044,            // ceiling of the arena mesh
  CORNER: 8064,       // corner bevel plane |x| + |y| = CORNER
  R: 256,             // floor/wall and ceiling/wall transition radius
  GOAL_HALF_W: 893,   // posts at x = +-893
  GOAL_H: 642.775,    // crossbar height
  GOAL_DEPTH: 880,    // back of net at |y| = Y + depth
};
export const GOAL_SCORE_Y = 5124.25; // ball centre must pass this + radius
// RocketSim adds infinite planes: floor z=0, ceiling z=ARENA_HEIGHT, side
// walls x=+-ARENA.X (contacts.js PLANES). Our mesh ceiling (2044) is in front.
export const ARENA_HEIGHT = 2048;

// --- Masses ----------------------------------------------------------------
export const CAR_MASS = 180;
export const BALL_MASS = CAR_MASS / 6;

// --- Ball ------------------------------------------------------------------
export const BALL_RADIUS = 91.25;
export const BALL_REST_Z = 93.15;
export const BALL_MAX_SPEED = 6000;
export const BALL_MAX_ANG_SPEED = 6;
export const BALL_DRAG = 0.03;           // fraction of velocity lost per second
export const BALL_FRICTION = 0.35;
export const BALL_RESTITUTION = 0.6;

// --- Car limits ------------------------------------------------------------
export const CAR_MAX_SPEED = 2300;
export const CAR_MAX_ANG_SPEED = 5.5;
export const SUPERSONIC_START_SPEED = 2200;
export const SUPERSONIC_MAINTAIN_MIN_SPEED = 2100;
export const SUPERSONIC_MAINTAIN_MAX_TIME = 1;

// --- Driving (RocketSim RLConst.h; forces in uu, mass 180) --------------------
// Engine force per wheel: throttle * THROTTLE_TORQUE_AMOUNT * drive speed
// scale (1600 uu/s^2 over four wheels at 0 speed); the brake caps each wheel's
// rolling-friction impulse at BRAKE_TORQUE_AMOUNT * (m/3) * dt (3500 uu/s^2).
export const THROTTLE_TORQUE_AMOUNT = CAR_MASS * 400;
export const BRAKE_TORQUE_AMOUNT = CAR_MASS * (14.25 + 1 / 3);
export const THROTTLE_ACCEL = 4 * THROTTLE_TORQUE_AMOUNT / CAR_MASS; // 1600 uu/s^2 (for planners)
export const DRIVE_SPEED_TORQUE_CURVE = [[0, 1], [1400, 0.1], [1410, 0]];
export const COASTING_BRAKE_FACTOR = 0.15;
export const STOPPING_FORWARD_VEL = 25;          // below this, coasting full-brakes and reverse throttle drives
export const BRAKING_NO_THROTTLE_SPEED_THRESH = 0.01;
export const THROTTLE_DEADZONE = 0.001;
export const THROTTLE_AIR_ACCEL = 200 / 3;
// btVehicleRL::calcFrictionImpulses rolling-friction gain while braking
export const ROLLING_FRICTION_SCALE_MAGIC = 113.73963;
// Bullet resolveSingleBilateral contactDamping (lateral tyre impulse gain)
export const BT_CONTACT_DAMPING = 0.2;
// Max front-wheel steer angle (rad) by forward speed (STEER_ANGLE_FROM_SPEED_CURVE)
export const STEER_ANGLE_CURVE = [[0, 0.53356], [500, 0.31930], [1000, 0.18203], [1500, 0.10570], [1750, 0.08507], [3000, 0.03454]];
export const POWERSLIDE_STEER_ANGLE_CURVE = [[0, 0.39235], [2500, 0.12610]];
export const LAT_FRICTION_CURVE = [[0, 1], [1, 0.2]];
export const LONG_FRICTION_CURVE = [[0, 1]];     // empty in RocketSim: constant 1
export const HANDBRAKE_LAT_FRICTION_FACTOR = 0.1;
export const HANDBRAKE_LONG_FRICTION_CURVE = [[0, 0.5], [1, 0.9]];
export const NON_STICKY_FRICTION_CURVE = [[0, 0.1], [0.7075, 0.5], [1, 1]];
export const POWERSLIDE_RISE_RATE = 5;
export const POWERSLIDE_FALL_RATE = 2;
export const STICKY_FORCE_BASE = 0.5;            // x gravity, plus 1 - |up.z| at full stick

// --- Suspension (per wheel) -------------------------------------------------
export const SUSPENSION_STIFFNESS = 500;
export const WHEELS_DAMPING_COMPRESSION = 25;
export const WHEELS_DAMPING_RELAXATION = 40;
export const MAX_SUSPENSION_TRAVEL = 12;
export const SUSPENSION_SUBTRACTION = 2.5;   // ray length = rest length + travel + radius - 2.5
export const SUSPENSION_FORCE_SCALE_FRONT = 36 - 1 / 4;
export const SUSPENSION_FORCE_SCALE_BACK = 54 + 1 / 4 + 1.5 / 100;

// --- Boost -----------------------------------------------------------------
export const BOOST_MAX = 100;
export const BOOST_USED_PER_SECOND = 100 / 3;
export const BOOST_MIN_TIME = 0.1;
export const BOOST_ACCEL_GROUND = 2975 / 3;
export const BOOST_ACCEL_AIR = 3175 / 3;
export const BOOST_SPAWN_AMOUNT = 100 / 3;

// RocketSim BoostPads: pickup if the car origin is within the cylinder
// (radius, |dz| < CYL_HEIGHT) or, for the car that was on the pad last tick,
// if its AABB overlaps the pad box (BOX_RAD, BOX_HEIGHT above the pad).
export const BOOST_PAD = {
  BIG_RADIUS: 208, SMALL_RADIUS: 144, CYL_HEIGHT: 95,
  BIG_BOX_RAD: 160, SMALL_BOX_RAD: 120, BOX_HEIGHT: 64,
  BIG_AMOUNT: 100, SMALL_AMOUNT: 12,
  BIG_COOLDOWN: 10, SMALL_COOLDOWN: 4,
  GRID_MAX_Z: 95 + 250, // BoostPadGrid::EXTENT_Z: cars above this never pick up
};

// [x, y, isBig]
export const BOOST_PADS = [
  [0, -4240, 0], [-1792, -4184, 0], [1792, -4184, 0], [-3072, -4096, 1], [3072, -4096, 1],
  [-940, -3308, 0], [940, -3308, 0], [0, -2816, 0], [-3584, -2484, 0], [3584, -2484, 0],
  [-1788, -2300, 0], [1788, -2300, 0], [-2048, -1036, 0], [0, -1024, 0], [2048, -1036, 0],
  [-3584, 0, 1], [-1024, 0, 0], [1024, 0, 0], [3584, 0, 1],
  [-2048, 1036, 0], [0, 1024, 0], [2048, 1036, 0], [-1788, 2300, 0], [1788, 2300, 0],
  [-3584, 2484, 0], [3584, 2484, 0], [0, 2816, 0], [-940, 3308, 0], [940, 3308, 0],
  [-3072, 4096, 1], [3072, 4096, 1], [-1792, 4184, 0], [1792, 4184, 0], [0, 4240, 0],
];

// --- Jumping / dodging ------------------------------------------------------
export const JUMP_ACCEL = 4375 / 3;
export const JUMP_MIN_TIME = 0.025;
export const JUMP_MAX_TIME = 0.2;
export const JUMP_IMMEDIATE_VEL = 875 / 3;
export const JUMP_PRE_MIN_ACCEL_SCALE = 0.62;
export const JUMP_RESET_TIME_PAD = 1 / 40;
export const DOUBLEJUMP_MAX_DELAY = 1.25;
export const DODGE_DEADZONE = 0.5;
export const FLIP_Z_DAMP_120 = 0.35;
export const FLIP_Z_DAMP_START = 0.15;
export const FLIP_Z_DAMP_END = 0.21;
export const FLIP_TORQUE_TIME = 0.65;
export const FLIP_PITCHLOCK_EXTRA_TIME = 0.3;
export const FLIP_INITIAL_VEL_SCALE = 500;
export const FLIP_TORQUE_X = 260; // roll (left / right dodge)
export const FLIP_TORQUE_Y = 224; // pitch (forward / backward dodge)
export const FLIP_FORWARD_IMPULSE_MAX_SPEED_SCALE = 1;
export const FLIP_SIDE_IMPULSE_MAX_SPEED_SCALE = 1.9;
export const FLIP_BACKWARD_IMPULSE_MAX_SPEED_SCALE = 2.5;
export const FLIP_BACKWARD_IMPULSE_SCALE_X = 16 / 15;

// --- Air control -------------------------------------------------------------
export const CAR_TORQUE_SCALE = (2 * Math.PI / 65536) * 1000;
export const AIR_TORQUE = { pitch: 130, yaw: 95, roll: 400 };
export const AIR_DAMPING = { pitch: 30, yaw: 20, roll: 50 };

export const AUTOFLIP_IMPULSE = 200;
export const AUTOFLIP_TORQUE = 50;
export const AUTOFLIP_TIME = 0.4;
export const AUTOFLIP_NORMZ_THRESH = Math.SQRT1_2;
export const AUTOFLIP_ROLL_THRESH = 2.8;
export const AUTOROLL_FORCE = 100;
export const AUTOROLL_TORQUE = 80;

// --- Collisions --------------------------------------------------------------
export const CAR_COLLISION_FRICTION = 0.3;   // body defaults (combined per pair)
export const CAR_COLLISION_RESTITUTION = 0.1;
export const ARENA_FRICTION = 0.6;
export const ARENA_RESTITUTION = 0.3;
export const CARBALL_FRICTION = 2.0;
export const CARBALL_RESTITUTION = 0.0;
export const CARWORLD_FRICTION = 0.3;
export const CARWORLD_RESTITUTION = 0.3;
export const CARCAR_FRICTION = 0.09;
export const CARCAR_RESTITUTION = 0.1;

export const BALL_CAR_EXTRA_IMPULSE_Z_SCALE = 0.35;
export const BALL_CAR_EXTRA_IMPULSE_FORWARD_SCALE = 0.65;
export const BALL_CAR_EXTRA_IMPULSE_MAX_DELTA_VEL = 4600;
export const BALL_CAR_EXTRA_IMPULSE_CURVE = [[0, 0.65], [500, 0.65], [2300, 0.55], [4600, 0.30]];

export const BUMP_COOLDOWN_TIME = 0.25;
export const BUMP_MIN_FORWARD_DIST = 64.5;
export const BUMP_VEL_GROUND_CURVE = [[0, 5 / 6], [1400, 1100], [2200, 1530]];
export const BUMP_VEL_AIR_CURVE = [[0, 5 / 6], [1400, 1390], [2200, 1945]];
export const BUMP_UPWARD_VEL_CURVE = [[0, 2 / 6], [1400, 278], [2200, 417]];
export const DEMO_RESPAWN_TIME = 3;

// --- Spawns ------------------------------------------------------------------
export const CAR_SPAWN_REST_Z = 17;
export const CAR_RESPAWN_Z = 36;
// Blue side (negative y). Orange mirrors x and y and adds PI to yaw.
export const KICKOFF_SPAWNS = [
  { x: -2048, y: -2560, yaw: Math.PI * 0.25 },
  { x: 2048, y: -2560, yaw: Math.PI * 0.75 },
  { x: -256, y: -3840, yaw: Math.PI * 0.5 },
  { x: 256, y: -3840, yaw: Math.PI * 0.5 },
  { x: 0, y: -4608, yaw: Math.PI * 0.5 },
];
export const RESPAWN_SPOTS = [
  { x: -2304, y: -4608, yaw: Math.PI * 0.5 },
  { x: -2688, y: -4608, yaw: Math.PI * 0.5 },
  { x: 2304, y: -4608, yaw: Math.PI * 0.5 },
  { x: 2688, y: -4608, yaw: Math.PI * 0.5 },
];

// --- Car body preset (hitbox + wheels) -------------------------------------
// All visual body styles share this hitbox so every car plays identically.
// hitbox: full size (length, width, height) and offset of its centre from the
// car origin (centre of mass), as reported by the game (used to fit the car
// models). simHitbox / simOffset: the box RocketSim simulates (CarConfig.cpp
// OCTANE; it reproduces RL's inertia matrix), used for collisions and inertia.
// Wheels: connection points (x, |y|, z), radius, suspension rest length.
export const CAR_PRESETS = {
  octane: {
    name: 'Octane-class', hitbox: [118.0074, 84.1994, 36.1591], offset: [13.8757, 0, 20.7553],
    simHitbox: [120.507, 86.6994, 38.6591], simOffset: [13.8757, 0, 20.755],
    front: { x: 51.25, y: 25.90, z: 20.755, radius: 12.50, rest: 38.755 },
    back: { x: -33.75, y: 29.50, z: 20.755, radius: 15.00, rest: 37.055 },
  },
};
