// rs_oracle: runs SoccerRocket oracle scenarios through RocketSim and prints
// per-tick JSON states. See README.md in this folder for the scenario format.
//
// Usage:
//   rs_oracle [--meshes DIR] [scenario.json ...]     (no files: read stdin)
// Input may be one scenario object or an array of them. Output mirrors the
// input shape: an object for one scenario, an array otherwise.
//
// All values use RocketSim / Rocket League conventions: uu, uu/s, rad/s,
// car-local x forward, y right, z up (the numeric frame shared with
// SoccerRocket's physics; run-js.mjs maps the control signs).
#include "RocketSim.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <unistd.h>
#include <vector>

using namespace RocketSim;

// ---------------------------------------------------------------------------
// Minimal JSON value + parser (objects, arrays, numbers, strings, bools, null)
// ---------------------------------------------------------------------------
struct J {
	enum T { NUL, BOOL, NUM, STR, ARR, OBJ } t = NUL;
	bool b = false;
	double n = 0;
	std::string s;
	std::vector<J> a;
	std::vector<std::pair<std::string, J>> o;

	const J* get(const char* k) const {
		if (t != OBJ) return nullptr;
		for (auto& kv : o) if (kv.first == k) return &kv.second;
		return nullptr;
	}
	bool has(const char* k) const { const J* v = get(k); return v && v->t != NUL; }
	double num(const char* k, double def) const { const J* v = get(k); return (v && v->t == NUM) ? v->n : (v && v->t == BOOL ? (v->b ? 1 : 0) : def); }
	bool flag(const char* k, bool def) const { const J* v = get(k); return v ? (v->t == BOOL ? v->b : (v->t == NUM ? v->n != 0 : def)) : def; }
	std::string str(const char* k, const std::string& def) const { const J* v = get(k); return (v && v->t == STR) ? v->s : def; }
};

struct Parser {
	const char* p;
	const char* end;
	[[noreturn]] void fail(const char* what) {
		std::cerr << "rs_oracle: JSON parse error: " << what << " near: " << std::string(p, std::min<size_t>(40, end - p)) << "\n";
		std::exit(2);
	}
	void ws() { while (p < end && (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t')) p++; }
	J value() {
		ws();
		if (p >= end) fail("unexpected end");
		J v;
		char c = *p;
		if (c == '{') {
			v.t = J::OBJ; p++; ws();
			if (*p == '}') { p++; return v; }
			for (;;) {
				ws(); if (*p != '"') fail("expected key");
				std::string k = string();
				ws(); if (*p != ':') fail("expected :"); p++;
				v.o.emplace_back(k, value());
				ws();
				if (*p == ',') { p++; continue; }
				if (*p == '}') { p++; break; }
				fail("expected , or }");
			}
		} else if (c == '[') {
			v.t = J::ARR; p++; ws();
			if (*p == ']') { p++; return v; }
			for (;;) {
				v.a.push_back(value());
				ws();
				if (*p == ',') { p++; continue; }
				if (*p == ']') { p++; break; }
				fail("expected , or ]");
			}
		} else if (c == '"') {
			v.t = J::STR; v.s = string();
		} else if (!strncmp(p, "true", 4)) { v.t = J::BOOL; v.b = true; p += 4; }
		else if (!strncmp(p, "false", 5)) { v.t = J::BOOL; v.b = false; p += 5; }
		else if (!strncmp(p, "null", 4)) { v.t = J::NUL; p += 4; }
		else {
			char* e;
			v.t = J::NUM; v.n = strtod(p, &e);
			if (e == p) fail("bad value");
			p = e;
		}
		return v;
	}
	std::string string() {
		std::string out;
		p++; // opening quote
		while (p < end && *p != '"') {
			if (*p == '\\') {
				p++;
				switch (*p) {
				case 'n': out += '\n'; break;
				case 't': out += '\t'; break;
				case 'r': out += '\r'; break;
				case 'b': out += '\b'; break;
				case 'f': out += '\f'; break;
				case 'u': { out += '?'; p += 4; break; }
				default: out += *p;
				}
				p++;
			} else out += *p++;
		}
		if (p >= end) fail("unterminated string");
		p++;
		return out;
	}
};

static J parseJson(const std::string& text) {
	Parser ps{ text.data(), text.data() + text.size() };
	J v = ps.value();
	return v;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------
struct Out {
	std::string buf;
	char tmp[64];
	void raw(const char* s) { buf += s; }
	void num(double v) {
		if (!std::isfinite(v)) { buf += "null"; return; }
		if (v == 0) { buf += '0'; return; }
		snprintf(tmp, sizeof tmp, "%.7g", v);
		buf += tmp;
	}
	void vec(const Vec& v) { buf += '['; num(v.x); buf += ','; num(v.y); buf += ','; num(v.z); buf += ']'; }
	void boolean(bool b) { buf += b ? "true" : "false"; }
	void str(const std::string& s) {
		buf += '"';
		for (char c : s) { if (c == '"' || c == '\\') buf += '\\'; buf += c; }
		buf += '"';
	}
};

static Vec vecOf(const J* v, Vec def) {
	if (!v || v->t != J::ARR || v->a.size() < 3) return def;
	return Vec((float)v->a[0].n, (float)v->a[1].n, (float)v->a[2].n);
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------
struct ControlKey { int tick; const J* j; };

// Cruise control shared with run-js.mjs: P-controller on forward speed.
static float cruiseThrottle(float target, float fwdSpeed) {
	float t = (target - fwdSpeed) / 100 + 0.01f;
	return t < 0.01f ? 0.01f : (t > 1 ? 1 : t);
}

static void applyControlEntry(CarControls& c, float& targetSpeed, const J& e) {
	if (const J* ts = e.get("targetSpeed")) targetSpeed = ts->t == J::NUM ? (float)ts->n : NAN;
	if (e.has("throttle")) c.throttle = (float)e.num("throttle", 0);
	if (e.has("steer")) c.steer = (float)e.num("steer", 0);
	if (e.has("pitch")) c.pitch = (float)e.num("pitch", 0);
	if (e.has("yaw")) c.yaw = (float)e.num("yaw", 0);
	if (e.has("roll")) c.roll = (float)e.num("roll", 0);
	if (e.has("jump")) c.jump = e.flag("jump", false);
	if (e.has("boost")) c.boost = e.flag("boost", false);
	if (e.has("handbrake")) c.handbrake = e.flag("handbrake", false);
}

static const Vec PARKED_BALL_POS = Vec(0, 0, 1900);

// Arenas are reused across scenarios: RocketSim's grid broadphase
// (btRSBroadphase, the default, which the game-accurate results depend on)
// registers static meshes cell by cell with a brute-force triangle scan, which
// costs ~0.25 s for our single arena-sized mesh on every Arena create/destroy.
// Reuse is exact: that broadphase rebuilds every contact pair each tick, and
// all car/ball state is replaced per scenario (verified identical to fresh
// arenas over the whole suite). RS_ORACLE_BROADPHASE=dbvt selects Bullet's
// DBVT broadphase instead (persistent manifolds, slightly different resting
// contacts; see README).
static Arena* getArena(bool pads) {
	static Arena* arenas[2] = { nullptr, nullptr };
	Arena*& a = arenas[pads ? 1 : 0];
	if (!a) {
		ArenaConfig cfg = {};
		const char* bp = getenv("RS_ORACLE_BROADPHASE");
		cfg.useCustomBroadphase = !(bp && !strcmp(bp, "dbvt"));
		if (!pads) {
			cfg.useCustomBoostPads = true;
			cfg.customBoostPads.clear();
		}
		a = Arena::Create(GameMode::SOCCAR, cfg, 120);
	} else {
		std::vector<Car*> old(a->_cars.begin(), a->_cars.end());
		for (Car* c : old) a->RemoveCar(c);
		for (BoostPad* pad : a->_boostPads) pad->SetState(BoostPadState());
	}
	a->SetCarBumpCallback(nullptr, nullptr);
	a->SetGoalScoreCallback(nullptr, nullptr);
	return a;
}

static void runScenario(const J& sc, Out& out) {
	const int ticks = (int)sc.num("ticks", 120);
	const int every = std::max(1, (int)sc.num("every", 1));
	const bool pads = sc.flag("pads", false);
	const bool unlimitedBoost = sc.flag("unlimitedBoost", false);

	Arena* arena = getArena(pads);

	MutatorConfig mut = MutatorConfig(GameMode::SOCCAR);
	if (unlimitedBoost) mut.boostUsedPerSecond = 0;
	if (const J* m = sc.get("mutators")) {
		if (m->has("demoMode")) {
			std::string dm = m->str("demoMode", "normal");
			mut.demoMode = dm == "disabled" ? DemoMode::DISABLED : (dm == "on_contact" ? DemoMode::ON_CONTACT : DemoMode::NORMAL);
		}
		if (m->has("enableTeamDemos")) mut.enableTeamDemos = m->flag("enableTeamDemos", false);
		if (m->has("ballHitExtraForceScale")) mut.ballHitExtraForceScale = (float)m->num("ballHitExtraForceScale", 1);
		if (m->has("bumpForceScale")) mut.bumpForceScale = (float)m->num("bumpForceScale", 1);
	}
	arena->SetMutatorConfig(mut);

	// Ball
	{
		BallState bs = BallState();
		const J* b = sc.get("ball");
		if (b && b->t == J::OBJ) {
			bs.pos = vecOf(b->get("pos"), Vec(0, 0, RLConst::BALL_REST_Z));
			bs.vel = vecOf(b->get("vel"), Vec());
			bs.angVel = vecOf(b->get("angVel"), Vec());
		} else {
			// Parked: zero velocity balls sleep in RocketSim (do not fall).
			bs.pos = PARKED_BALL_POS;
		}
		arena->ball->SetState(bs);
	}

	// Cars
	std::vector<Car*> cars;
	std::vector<std::vector<ControlKey>> timelines;
	if (const J* cs = sc.get("cars")) {
		for (const J& cj : cs->a) {
			Team team = cj.num("team", 0) ? Team::ORANGE : Team::BLUE;
			Car* car = arena->AddCar(team, CAR_CONFIG_OCTANE);
			CarState st = CarState();
			st.pos = vecOf(cj.get("pos"), Vec(0, 0, RLConst::CAR_SPAWN_REST_Z));
			st.vel = vecOf(cj.get("vel"), Vec());
			st.angVel = vecOf(cj.get("angVel"), Vec());
			if (cj.has("forward")) {
				st.rotMat = RotMat::LookAt(vecOf(cj.get("forward"), Vec(1, 0, 0)), vecOf(cj.get("up"), Vec(0, 0, 1)));
			} else {
				st.rotMat = Angle((float)cj.num("yaw", 0), (float)cj.num("pitch", 0), (float)cj.num("roll", 0)).ToRotMat();
			}
			st.boost = (float)cj.num("boost", RLConst::BOOST_SPAWN_AMOUNT);
			st.isOnGround = cj.flag("isOnGround", true);
			st.hasJumped = cj.flag("hasJumped", false);
			st.hasDoubleJumped = cj.flag("hasDoubleJumped", false);
			st.hasFlipped = cj.flag("hasFlipped", false);
			st.airTimeSinceJump = (float)cj.num("airTimeSinceJump", 0);
			car->SetState(st);
			cars.push_back(car);

			std::vector<ControlKey> tl;
			if (const J* ctl = cj.get("controls")) for (const J& e : ctl->a) tl.push_back({ (int)e.num("tick", 0), &e });
			std::stable_sort(tl.begin(), tl.end(), [](const ControlKey& a, const ControlKey& b) { return a.tick < b.tick; });
			timelines.push_back(tl);
		}
	}

	auto carIndex = [&](Car* c) -> int {
		for (size_t i = 0; i < cars.size(); i++) if (cars[i] == c) return (int)i;
		return -1;
	};

	// Events
	struct Ev { int tick; std::string type; int a; int b; Vec v; };
	std::vector<Ev> events;
	int curStep = 0;
	bool goalSeen = false;
	struct CbCtx { std::vector<Ev>* ev; int* step; std::function<int(Car*)>* idx; bool* goalSeen; };
	std::function<int(Car*)> idxFn = carIndex;
	CbCtx ctx{ &events, &curStep, &idxFn, &goalSeen };
	arena->SetCarBumpCallback([](Arena*, Car* bumper, Car* victim, bool isDemo, void* ui) {
		CbCtx* c = (CbCtx*)ui;
		c->ev->push_back({ *c->step, isDemo ? "demo" : "bump", (*c->idx)(bumper), (*c->idx)(victim), Vec() });
	}, &ctx);
	arena->SetGoalScoreCallback([](Arena*, Team team, void* ui) {
		CbCtx* c = (CbCtx*)ui;
		if (*c->goalSeen) return;
		*c->goalSeen = true;
		c->ev->push_back({ *c->step, "goal", team == Team::BLUE ? 0 : 1, -1, Vec() });
	}, &ctx);

	std::vector<size_t> tlPos(cars.size(), 0);
	std::vector<CarControls> controls(cars.size());
	std::vector<float> targetSpeeds(cars.size(), NAN);

	out.raw("{\"name\":"); out.str(sc.str("name", "unnamed"));
	out.raw(",\"engine\":\"rocketsim\",\"ticks\":"); out.num(ticks);
	out.raw(",\"every\":"); out.num(every);
	out.raw(",\"frames\":[");

	auto writeFrame = [&](int tick) {
		if (tick > 0) out.raw(",");
		out.raw("{\"tick\":"); out.num(tick);
		BallState bs = arena->ball->GetState();
		out.raw(",\"ball\":{\"pos\":"); out.vec(bs.pos);
		out.raw(",\"vel\":"); out.vec(bs.vel);
		out.raw(",\"angVel\":"); out.vec(bs.angVel);
		out.raw("},\"cars\":[");
		for (size_t i = 0; i < cars.size(); i++) {
			if (i) out.raw(",");
			CarState s = cars[i]->GetState();
			int nw = 0;
			for (int w = 0; w < 4; w++) nw += s.wheelsWithContact[w];
			out.raw("{\"pos\":"); out.vec(s.pos);
			out.raw(",\"vel\":"); out.vec(s.vel);
			out.raw(",\"angVel\":"); out.vec(s.angVel);
			out.raw(",\"fwd\":"); out.vec(s.rotMat.forward);
			out.raw(",\"up\":"); out.vec(s.rotMat.up);
			out.raw(",\"onGround\":"); out.boolean(s.isOnGround);
			out.raw(",\"wheels\":"); out.num(nw);
			out.raw(",\"hasJumped\":"); out.boolean(s.hasJumped);
			out.raw(",\"hasDoubleJumped\":"); out.boolean(s.hasDoubleJumped);
			out.raw(",\"hasFlipped\":"); out.boolean(s.hasFlipped);
			out.raw(",\"isFlipping\":"); out.boolean(s.isFlipping);
			out.raw(",\"isJumping\":"); out.boolean(s.isJumping);
			out.raw(",\"boost\":"); out.num(s.boost);
			out.raw(",\"demoed\":"); out.boolean(s.isDemoed);
			out.raw(",\"handbrake\":"); out.num(s.handbrakeVal);
			out.raw(",\"supersonic\":"); out.boolean(s.isSupersonic);
			out.raw(",\"jumpTime\":"); out.num(s.jumpTime);
			out.raw(",\"flipTime\":"); out.num(s.flipTime);
			out.raw(",\"airTime\":"); out.num(s.airTime);
			out.raw("}");
		}
		out.raw("]}");
	};

	writeFrame(0);
	for (int t = 0; t < ticks; t++) {
		for (size_t i = 0; i < cars.size(); i++) {
			auto& tl = timelines[i];
			while (tlPos[i] < tl.size() && tl[tlPos[i]].tick <= t) {
				applyControlEntry(controls[i], targetSpeeds[i], *tl[tlPos[i]].j);
				tlPos[i]++;
			}
			CarControls c = controls[i];
			if (!std::isnan(targetSpeeds[i])) {
				CarState s = cars[i]->GetState();
				c.throttle = cruiseThrottle(targetSpeeds[i], s.vel.Dot(s.rotMat.forward));
			}
			cars[i]->controls = c;
		}
		curStep = t + 1;
		uint64_t tickBefore = arena->tickCount;
		arena->Step(1);
		for (size_t i = 0; i < cars.size(); i++) {
			const BallHitInfo& hi = cars[i]->_internalState.ballHitInfo;
			if (hi.isValid && hi.tickCountWhenHit == tickBefore) {
				bool extra = hi.tickCountWhenExtraImpulseApplied == tickBefore;
				events.push_back({ t + 1, extra ? "ballHit" : "ballTouch", (int)i, -1, hi.extraHitVel });
			}
		}
		if ((t + 1) % every == 0 || t + 1 == ticks) writeFrame(t + 1);
	}
	out.raw("],\"events\":[");
	for (size_t i = 0; i < events.size(); i++) {
		const Ev& e = events[i];
		if (i) out.raw(",");
		out.raw("{\"tick\":"); out.num(e.tick);
		out.raw(",\"type\":"); out.str(e.type);
		if (e.type == "goal") { out.raw(",\"team\":"); out.num(e.a); }
		else if (e.type == "ballHit" || e.type == "ballTouch") { out.raw(",\"car\":"); out.num(e.a); out.raw(",\"extraVel\":"); out.vec(e.v); }
		else { out.raw(",\"attacker\":"); out.num(e.a); out.raw(",\"victim\":"); out.num(e.b); }
		out.raw("}");
	}
	out.raw("]}");
	// Leave no callbacks pointing at this stack frame.
	arena->SetCarBumpCallback(nullptr, nullptr);
	arena->SetGoalScoreCallback(nullptr, nullptr);
}

static std::string readAll(std::istream& in) {
	std::stringstream ss; ss << in.rdbuf(); return ss.str();
}

static std::string exeDir() {
	char buf[4096];
	ssize_t n = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
	if (n <= 0) return ".";
	buf[n] = 0;
	std::string s(buf);
	size_t k = s.find_last_of('/');
	return k == std::string::npos ? "." : s.substr(0, k);
}

int main(int argc, char** argv) {
	// RocketSim logs to std::cout; keep stdout clean for JSON.
	std::cout.rdbuf(std::cerr.rdbuf());

	std::string meshDir = exeDir() + "/meshes";
	std::vector<std::string> files;
	for (int i = 1; i < argc; i++) {
		std::string a = argv[i];
		if (a == "--meshes" && i + 1 < argc) meshDir = argv[++i];
		else files.push_back(a);
	}

	RocketSim::Init(meshDir, true);
	if (RocketSim::GetArenaCollisionShapes(GameMode::SOCCAR).empty()) {
		std::cerr << "rs_oracle: no soccar meshes in " << meshDir << "/soccar (run export-cmf.mjs)\n";
		return 3;
	}

	std::vector<J> docs;
	if (files.empty()) docs.push_back(parseJson(readAll(std::cin)));
	else for (auto& f : files) {
		std::ifstream in(f);
		if (!in.good()) { std::cerr << "rs_oracle: cannot read " << f << "\n"; return 2; }
		docs.push_back(parseJson(readAll(in)));
	}

	std::vector<const J*> scenarios;
	bool asArray = docs.size() > 1;
	for (auto& d : docs) {
		if (d.t == J::ARR) { asArray = true; for (auto& s : d.a) scenarios.push_back(&s); }
		else scenarios.push_back(&d);
	}

	Out out;
	if (asArray) out.raw("[");
	for (size_t i = 0; i < scenarios.size(); i++) {
		if (i) out.raw(",\n");
		runScenario(*scenarios[i], out);
	}
	if (asArray) out.raw("]");
	out.raw("\n");
	fwrite(out.buf.data(), 1, out.buf.size(), stdout);
	return 0;
}
