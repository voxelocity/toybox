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
  Z: 2044,            // ceiling
  CORNER: 8064,       // corner bevel plane |x| + |y| = CORNER
  R: 256,             // floor/wall and ceiling/wall transition radius
  GOAL_HALF_W: 893,   // posts at x = +-893
  GOAL_H: 642.775,    // crossbar height
  GOAL_DEPTH: 880,    // back of net at |y| = Y + depth
};
export const GOAL_SCORE_Y = 5124.25; // ball centre must pass this + radius

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

// --- Driving ---------------------------------------------------------------
export const THROTTLE_ACCEL = 1600;              // all four wheels, at 0 speed
export const DRIVE_SPEED_TORQUE_CURVE = [[0, 1], [1400, 0.1], [1410, 0]];
export const BRAKE_ACCEL = 3500;
export const COASTING_BRAKE_FACTOR = 0.15;
export const STOPPING_FORWARD_VEL = 25;
export const THROTTLE_DEADZONE = 0.001;
export const THROTTLE_AIR_ACCEL = 200 / 3;
// Effective front-wheel steer angle by forward speed. Calibrated with
// tools/calibrate-steer.mjs so that steady-state turning curvature matches the
// measured max-curvature table (0.00398 @500, 0.00235 @1000, 0.001375 @1500,
// 0.0011 @1750, 0.00088 @2300) given this tyre model's slip.
export const STEER_ANGLE_CURVE = [[0, 0.53356], [500, 0.32542], [1000, 0.19195], [1500, 0.11152], [1750, 0.08862], [2300, 0.06983], [3000, 0.04592]];
export const POWERSLIDE_STEER_ANGLE_CURVE = [[0, 0.39235], [2500, 0.12610]];
export const LAT_FRICTION_CURVE = [[0, 1], [1, 0.2]];
export const LONG_FRICTION_CURVE = [[0, 1], [1, 1]];
export const HANDBRAKE_LAT_FRICTION_FACTOR = 0.1;
export const HANDBRAKE_LONG_FRICTION_CURVE = [[0, 0.5], [1, 0.9]];
export const NON_STICKY_FRICTION_CURVE = [[0, 0.1], [0.7075, 0.5], [1, 1]];
export const POWERSLIDE_RISE_RATE = 5;
export const POWERSLIDE_FALL_RATE = 2;
export const STICKY_FORCE_BASE = 0.5;            // x gravity, extra wall term below
export const LATERAL_CONTACT_DAMPING = 0.2;      // bilateral friction constraint gain
export const ROLL_INFLUENCE = 0;          // friction applied in the COM plane

// --- Suspension (per wheel) -------------------------------------------------
export const SUSPENSION_STIFFNESS = 500;
export const WHEELS_DAMPING_COMPRESSION = 25;
export const WHEELS_DAMPING_RELAXATION = 40;
export const MAX_SUSPENSION_TRAVEL = 12;
export const SUSPENSION_SUBTRACTION = 2.5;   // ray reach = rest length + radius - 2.5
export const SUSPENSION_FORCE_SCALE_FRONT = 36 - 1 / 4;
export const SUSPENSION_FORCE_SCALE_BACK = 54 + 1 / 4 + 1.5 / 100;

// --- Boost -----------------------------------------------------------------
export const BOOST_MAX = 100;
export const BOOST_USED_PER_SECOND = 100 / 3;
export const BOOST_MIN_TIME = 0.1;
export const BOOST_ACCEL_GROUND = 2975 / 3;
export const BOOST_ACCEL_AIR = 3175 / 3;
export const BOOST_SPAWN_AMOUNT = 100 / 3;

export const BOOST_PAD = {
  BIG_RADIUS: 208, SMALL_RADIUS: 144, HEIGHT: 168,
  BIG_AMOUNT: 100, SMALL_AMOUNT: 12,
  BIG_COOLDOWN: 10, SMALL_COOLDOWN: 4,
};

// [x, y, isBig]
export const BOOST_PADS = [
  [0, -4240, 0], [-1792, -4184, 0], [1792, -4184, 0], [-3072, -4096, 1], [3072, -4096, 1],
  [-940, -3308, 0], [940, -3308, 0], [0, -2816, 0], [-3584, -2484, 0], [3584, -2484, 0],
  [-1788, -2300, 0], [1788, -2300, 0], [-2048, -1036, 0], [0, -1024, 0], [2048, -1036, 0],
  [-3584, 0, 1], [-1024, 0, 0], [1024, 0, 0], [3584, 0, 1],
  [-2048, 1036, 0], [0, 1024, 0], [2048, 1036, 0], [-1788, 2300, 0], [1788, 2300, 0],
  [-3584, 2484, 0], [3584, 2484, 0], [0, 2816, 0], [-940, 3310, 0], [940, 3308, 0],
  [-3072, 4096, 1], [3072, 4096, 1], [-1792, 4184, 0], [1792, 4184, 0], [0, 4240, 0],
];

// --- Jumping / dodging ------------------------------------------------------
export const JUMP_ACCEL = 4375 / 3;
export const JUMP_MIN_TIME = 0.025;
export const JUMP_MAX_TIME = 0.2;
export const JUMP_IMMEDIATE_VEL = 875 / 3;
export const JUMP_PRE_MIN_ACCEL_SCALE = 0.62;
export const DOUBLEJUMP_MAX_DELAY = 1.25;
export const DODGE_DEADZONE = 0.5;
export const FLIP_Z_DAMP_120 = 0.35;
export const FLIP_Z_DAMP_START = 0.15;
export const FLIP_Z_DAMP_END = 0.21;
export const FLIP_TORQUE_TIME = 0.65;
export const FLIP_PITCHLOCK_EXTRA_TIME = 0.3;
export const FLIP_INITIAL_VEL_SCALE = 500;
export const FLIP_TORQUE_ROLL = 260;
export const FLIP_TORQUE_PITCH = 224;
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
export const AUTOROLL_FORCE = 100;
export const AUTOROLL_TORQUE = 80;

// --- Collisions --------------------------------------------------------------
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
// car origin (centre of mass). Wheels: connection points (x, |y|, z), radius,
// suspension rest length.
export const CAR_PRESETS = {
  octane: {
    name: 'Octane-class', hitbox: [118.0074, 84.1994, 36.1591], offset: [13.8757, 0, 20.7553],
    front: { x: 51.25, y: 25.90, z: 20.755, radius: 12.50, rest: 38.755 },
    back: { x: -33.75, y: 29.50, z: 20.755, radius: 15.00, rest: 37.055 },
  },
};
