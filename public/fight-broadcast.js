// Presentation time is separate from the deterministic simulation. Replaying or
// changing speed must never change a hit, the round score, or the winner.
const slowStart = 0.23;
const slowEnd = 0.7;
const slowRate = 0.28;

export function isKeyHit(beat) {
  return beat.events.some(
    (event) =>
      event.damage > 0 &&
      (event.action === "ultimate" ||
        event.damage >= 12 ||
        beat.states[1 - event.player].hp === 0),
  );
}

export function roundCall(round) {
  const states = round.beats.at(-1).states;
  if (states.every((state) => state.hp === 0)) return "DOUBLE K.O.";
  if (states.some((state) => state.hp === 0)) return "K.O.";
  return round.winner === null ? "DRAW" : "TIME UP";
}

export function buildBroadcast(replay) {
  const segments = [];
  let end = 0;
  const add = (type, duration, data = {}) => {
    segments.push({ type, start: end, end: end + duration, ...data });
    end += duration;
  };
  for (let player = 0; player < 2; player++) add("entrance", 3.8, { player });
  for (const round of replay.rounds) {
    add("countdown", 3.8, { round });
    round.beats.forEach((beat, index) => {
      const baseDuration = Math.max(1.2, replay.beatDuration);
      const keyHit = isKeyHit(beat);
      const duration = keyHit
        ? baseDuration * (1 + (slowEnd - slowStart) * (1 / slowRate - 1))
        : baseDuration;
      add("fight", duration, { round, beat, index, baseDuration, keyHit });
    });
    add("outro", 3.8, { round });
  }
  return { segments, duration: end };
}

export function broadcastAt(timeline, elapsed) {
  const segment = timeline.segments.find((part) => elapsed < part.end);
  if (!segment) return { type: "complete" };
  const local = Math.max(0, elapsed - segment.start);
  if (segment.type !== "fight")
    return { ...segment, progress: local / (segment.end - segment.start) };
  let progress = local / segment.baseDuration;
  if (segment.keyHit && progress > slowStart) {
    const slowDuration = (slowEnd - slowStart) / slowRate;
    progress = progress < slowStart + slowDuration
      ? slowStart + (progress - slowStart) * slowRate
      : slowEnd + progress - slowStart - slowDuration;
  }
  return {
    ...segment,
    progress: Math.min(1, progress),
    slowMotion: segment.keyHit && progress >= slowStart && progress < slowEnd,
  };
}
