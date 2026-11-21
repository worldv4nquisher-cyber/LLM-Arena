// One contact cue drives the rig, projectiles, HUD, sound and impact effects.
export const CONTACT = 0.48;
export const RELEASE = 0.22;
export const clamp = (n) => Math.max(0, Math.min(1, n));
export const ease = (n) => {
  const p = clamp(n);
  return p * p * (3 - 2 * p);
};
export const isMelee = (action) => ["strike", "heavy"].includes(action);
export const isRanged = (action) => ["blast", "ultimate"].includes(action);

export function motion(action, progress) {
  const p = clamp(progress);
  const recovery = 1 - ease((p - 0.59) / 0.41);
  const extension = ease((p - (action === "heavy" ? 0.32 : 0.16)) /
    (CONTACT - (action === "heavy" ? 0.32 : 0.16))) * recovery;
  const windup = Math.sin(clamp(p / 0.34) * Math.PI) *
    (action === "heavy" || action === "ultimate" ? 1 : 0.35);
  return { extension, windup, recovery };
}

export function reaction(beat, side, progress) {
  const event = beat.events.find((e) => e.player !== side);
  const struck = event?.damage > 0;
  const recoil = struck
    ? ease((progress - CONTACT) / 0.08) * (1 - ease((progress - 0.65) / 0.35))
    : 0;
  return {
    event,
    recoil,
    blocked: event?.outcome === "block",
    down: beat.states[side].hp === 0 ? ease((progress - CONTACT) / 0.48) : 0,
  };
}

export function combatPositions(previous, beat, progress) {
  const positions = beat.states.map((s, i) =>
    previous[i].x + (s.x - previous[i].x) * ease(progress / CONTACT));
  const lunges = beat.actions.map((action, i) => {
    const event = beat.events.find((e) => e.player === i);
    return isMelee(action) && event?.outcome !== "miss" ? motion(action, progress).extension : 0;
  });
  // Close the visual collision space, not the simulation's authoritative spacing.
  // Split the lunge when both attack so simultaneous punches don't cross bodies.
  const reach = Math.max(0, positions[1] - positions[0] - 1.12);
  const total = Math.max(1, lunges[0] + lunges[1]);
  return positions.map((x, i) => x + (i ? -1 : 1) * reach * lunges[i] / total);
}
