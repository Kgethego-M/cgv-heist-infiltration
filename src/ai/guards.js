import * as THREE from 'three';

// Placeholder body shared by both guards — a navy capsule (guard uniform
// colour). When the character owner's .glb variants land, replace this with
// GLTFLoader + AnimationMixer; nothing else in this file needs to change.
function makeGuardBody() {
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 1.2, 4, 12),
    new THREE.MeshStandardMaterial({
      color: 0x2b3a67,
      emissive: 0x3d5a99,       // self-glow: guards stay visible in the dark lobby
      emissiveIntensity: 0.6,
    })
  );
  body.position.y = 0.9; // capsule centre: (1.2 + 2*0.3) / 2, so feet are on the floor
  return body;
}


// GUARD A — stationary at the reception desk. Takedown + uniform
// loot target. No vision of his own (Level 1 doc, section 6).
export class GuardA {
  constructor(scene, game, position) {
    this.game = game;
    this.down = false;      // taken down?
    this.looted = false;    // uniform taken?
    this.idleTime = 0;
    this.interactDistance = 1.8; // horizontal metres

    this.group = new THREE.Group();
    this.group.name = 'GuardA';
    this.body = makeGuardBody();
    this.group.add(this.body);
    this.group.position.copy(position);
    // Face into the lobby (towards the room centre)
    this.baseRotation = Math.atan2(-position.x, -position.z);
    this.group.rotation.y = this.baseRotation;
    scene.add(this.group);

    this._tmp = new THREE.Vector3(); // reused — never allocate per frame
  }

  // Horizontal distance only: the camera sits at y=1.6, the guard at y=0,
  // so a plain distanceTo() would count that height difference against the player
  horizDistanceTo(playerPos) {
    this._tmp.subVectors(playerPos, this.group.position);
    this._tmp.y = 0;
    return this._tmp.length();
  }

  update(dt) {
    if (this.down) return;
    // Idle sway — subtle, sells "alive" without an animation cycle
    this.idleTime += dt;
    this.group.rotation.y = this.baseRotation + Math.sin(this.idleTime * 0.5) * 0.15;
  }

  // Prompt text when the player can interact, otherwise null
  getPrompt(playerPos) {
    if (this.horizDistanceTo(playerPos) > this.interactDistance) return null;
    if (!this.down) return '[E] Take down guard';
    if (!this.looted) return '[E] Take uniform';
    return null;
  }

  // Called on E press. Returns true if an action actually happened.
  tryInteract(playerPos) {
    if (this.horizDistanceTo(playerPos) > this.interactDistance) return false;
    if (!this.down) { this.takeDown(); return true; }
    if (!this.looted) { this.loot(); return true; }
    return false;
  }

  takeDown() {
    this.down = true;
    this.game.guardADown = true; // what triggers the partner-check alarm later
    // Tip the body over: rotating the group lies the capsule flat,
    // raising the pivot stops it sinking into the floor
    this.group.rotation.y = this.baseRotation; // stop the sway first
    this.group.rotation.z = Math.PI / 2;
    this.body.position.y = 1.2;
  }

  loot() {
    this.looted = true;
    this.game.hasDisguise = true;
    // The visual material swap on the player is the Character owner's job —
    // this flag is the contract between us.
  }

  reset() {
    this.down = false;
    this.looted = false;
    this.idleTime = 0;
    this.group.rotation.z = 0;
    this.group.rotation.y = this.baseRotation;
    this.body.position.y = 0.9;
  }
}

// GUARD B — patrols the lobby, sees the player, raises the alarm,
// then chases. One alarm system for both causes (doc, beat 10).

export class GuardB {
  constructor(scene, waypoints, colliders, game, options = {}) {
    this.waypoints = waypoints;
    this.colliders = colliders;
    this.game = game;
    this.partnerCheckIndex = options.partnerCheckIndex ?? -1; // the "check partner" stop

    // --- movement ---
    this.state = 'patrol';      // 'patrol' | 'pause' | 'chase'
    this.speed = 0.65;          // m/s — full loop ≈ 35s incl. pauses; tune by playtesting
    this.chaseSpeed = 2.4;      // slower than the player (3 m/s) so escape stays possible
    this.pauseTime = 2;         // seconds spent at each waypoint
    this.index = 0;
    this.pauseTimer = 0;

    // --- vision ---
    this.visionRange = 9;                                   // metres, undisguised
    this.visionRangeDisguised = 4;                          // disguised: only spotted closer
    this.visionHalfAngle = THREE.MathUtils.degToRad(50);    // 100° total cone
    this.closeRange = 2.5;      // inside this: range/cone relaxed even while disguised
    this.checkInterval = 0.1;   // vision runs 10x/second, not every frame (brief, 6.1)
    this.checkTimer = 0;
    this.catchDistance = 1.2;

    // --- reused every frame: created ONCE here, never in update() ---
    this._dir = new THREE.Vector3();
    this._toPlayer = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();

    // --- scene objects (after the scratch vectors, so faceWaypoint can use them) ---
    this.group = new THREE.Group();
    this.group.name = 'GuardB';
    this.body = makeGuardBody();
    this.group.add(this.body);
    this.group.position.copy(waypoints[0]);
    this.faceWaypoint(1); // start facing the NEXT stop — never the player's spawn
    scene.add(this.group);
  }

  faceWaypoint(i) {
    const target = this.waypoints[i % this.waypoints.length];
    this._dir.subVectors(target, this.group.position);
    this._dir.y = 0;
    if (this._dir.lengthSq() > 0) {
      this.group.rotation.y = Math.atan2(this._dir.x, this._dir.z);
    }
  }

  update(dt, playerPos) {
    // Any alarm cause puts him into chase (there is only one alarm system)
    if (this.state !== 'chase' && this.game.alarmActive) {
      this.state = 'chase';
    }
    if (this.state === 'chase') {
      this.updateChase(dt, playerPos);
      return;
    }

    // Vision check on a timer — 10x/second is plenty and keeps it cheap
    this.checkTimer += dt;
    if (this.checkTimer >= this.checkInterval) {
      this.checkTimer = 0;
      if (this.canSeePlayer(playerPos)) {
        this.game.triggerAlarm('player_spotted');
        return; // chase starts next frame
      }
    }

    if (this.state === 'pause') {
      this.pauseTimer -= dt;
      if (this.pauseTimer <= 0) {
        this.index = (this.index + 1) % this.waypoints.length; // % is what makes it a loop
        this.state = 'patrol';
      }
      return;
    }

    // Patrol: steer towards the current waypoint
    this._dir.subVectors(this.waypoints[this.index], this.group.position);
    this._dir.y = 0;
    if (this._dir.length() > 0.15) {
      this._dir.normalize();
      this.group.position.addScaledVector(this._dir, this.speed * dt);
      this.group.rotation.y = Math.atan2(this._dir.x, this._dir.z); // face travel direction
    } else {
      this.arriveAtWaypoint();
    }
  }

  arriveAtWaypoint() {
    // The partner check: when his loop passes the spot next to Guard A and
    // his partner isn't standing there, the alarm fires immediately (beat 7).
    if (this.index === this.partnerCheckIndex && this.game.guardADown) {
      this.game.triggerAlarm('partner_found');
    }
    this.state = 'pause';
    this.pauseTimer = this.pauseTime;
  }

  // Three tests, cheapest first: range → cone → occlusion raycast
  canSeePlayer(playerPos) {
    // 1. RANGE — disguise shrinks the detection distance
    this._toPlayer.subVectors(playerPos, this.group.position);
    this._toPlayer.y = 0;
    const dist = this._toPlayer.length();
    const range = this.game.hasDisguise ? this.visionRangeDisguised : this.visionRange;
    const withinRange = dist < range;
    const tooClose = dist < this.closeRange; // "too close even while disguised"
    if (!withinRange && !tooClose) return false;

    this._toPlayer.normalize();

    // 2. CONE — forward · toPlayer is cos(θ) of the angle between them; the
    // player is inside the cone when θ is SMALLER than the half-angle,
    // i.e. when the dot product is LARGER than cos(halfAngle)
    this._forward.set(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
    const inCone = this._forward.dot(this._toPlayer) > Math.cos(this.visionHalfAngle);
    if (!inCone && !tooClose) return false;

    // 3. OCCLUSION — raycast eye→player against walls/pillars; any hit blocks sight.
    // Horizontal ray at eye height: the Offices are safe because their walls block it.
    this._eye.set(this.group.position.x, 1.6, this.group.position.z);
    this.raycaster.set(this._eye, this._toPlayer);
    this.raycaster.far = dist;
    return this.raycaster.intersectObjects(this.colliders, false).length === 0;
  }

  updateChase(dt, playerPos) {
    this._dir.subVectors(playerPos, this.group.position);
    this._dir.y = 0;
    const dist = this._dir.length();
    if (dist < this.catchDistance) {
      this.game.onCaught(); // lose state — main.js resets the level, no page refresh
      return;
    }
    this._dir.normalize();
    // Straight-line steering, no pathfinding — he can snag on corners. Fine for
    // Level 1's open rooms; revisit if playtesting shows it feels dumb.
    this.group.position.addScaledVector(this._dir, this.chaseSpeed * dt);
    this.group.rotation.y = Math.atan2(this._dir.x, this._dir.z);
  }

  reset() {
    this.state = 'patrol';
    this.index = 0;
    this.pauseTimer = 0;
    this.checkTimer = 0;
    this.group.position.copy(this.waypoints[0]);
    this.faceWaypoint(1);
  }
}