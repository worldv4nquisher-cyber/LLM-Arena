import { fighters, styles, actionNames } from "./fight-engine.js";
import { buildBroadcast, broadcastAt, roundCall } from "./fight-broadcast.js";

const $ = (id) => document.getElementById(id);
const symbols = {
  gpt: "✧",
  claude: "✺",
  gemini: "✦",
  deepseek: "≋",
  grok: "♆",
};
const players = [$("player-0"), $("player-1")],
  tactics = [$("tactic-0"), $("tactic-1")];
let scene,
  replay,
  timeline,
  elapsed = 0,
  playing = false,
  lastFrame,
  lastBeat = "",
  lastPhase = "",
  finished = false,
  sound = false,
  audio;
let lastCommentary = -Infinity;
let savedMatches = [];
try {
  const saved = JSON.parse(localStorage.getItem("celestial-matches") ?? "[]");
  if (Array.isArray(saved))
    savedMatches = saved
      .filter(
        (m) =>
          m &&
          Array.isArray(m.players) &&
          m.players.length === 2 &&
          m.players.every((id) => fighters.some((f) => f.id === id)) &&
          Array.isArray(m.wins) &&
          m.wins.length === 2 &&
          m.wins.every(Number.isInteger) &&
          Number.isSafeInteger(m.seed) &&
          Array.isArray(m.tactics) &&
          m.tactics.length === 2 &&
          m.tactics.every((t) => Object.hasOwn(styles, t)),
      )
      .slice(0, 8);
} catch {
  /* Private browsing and damaged history must not prevent a match. */
}

function config(i) {
  return fighters.find((f) => f.id === players[i].value);
}
function option(value, text) {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = text;
  return el;
}
players.forEach((select, i) => {
  fighters.forEach((f) =>
    select.append(option(f.id, `${f.name} · ${f.title}`)),
  );
  select.value = i ? "claude" : "gpt";
  Object.entries(styles).forEach(([id, name]) =>
    tactics[i].append(option(id, name)),
  );
  tactics[i].value = config(i).style;
  select.addEventListener("change", () => {
    tactics[i].value = config(i).style;
    resetSelection();
  });
  tactics[i].addEventListener("change", resetSelection);
});

function updateNames() {
  players.forEach((_, i) => {
    const f = config(i);
    $(`name-${i}`).textContent = f.name;
    $(`title-${i}`).textContent = f.title;
    $(`portrait-${i}`).textContent = symbols[f.id];
    $(`hud-${i}`).style.setProperty("--fighter", f.color);
    $(`config-${i}`).style.setProperty("--fighter", f.color);
  });
  document.querySelectorAll(".roster-card").forEach((card) => {
    const selected = card.dataset.fighter === players[0].value;
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-pressed", String(selected));
    card.querySelector(".roster-p1").textContent = selected ? "P1" : "";
  });
}
function updateStats(
  states = [
    { hp: 100, energy: 15 },
    { hp: 100, energy: 15 },
  ],
  wins = [0, 0],
) {
  states.forEach((state, i) => {
    $(`hp-${i}`).textContent = state.hp;
    $(`health-${i}`).style.width = `${state.hp}%`;
    $(`energy-${i}`).style.width = `${state.energy}%`;
    $(`wins-${i}`).textContent = [0, 1]
      .map((n) => (wins[i] > n ? "◆" : "◇"))
      .join(" ");
  });
}
function announce(
  title,
  subtitle = "",
  eyebrow = "CELESTIAL CLASH",
  result = false,
) {
  const el = $("center-announcement");
  el.classList.remove("hidden");
  el.classList.toggle("result", result);
  el.dataset.kind = result ? "result" : "slate";
  el.querySelector("strong").textContent = title;
  el.querySelector("span").textContent = subtitle;
  el.querySelector("small").textContent = eyebrow;
}
function resetSelection() {
  if (playing) return;
  replay = null;
  finished = false;
  elapsed = 0;
  lastBeat = "";
  lastPhase = "";
  scene?.setFighters(players.map((_, i) => config(i)));
  if (scene) scene.presentation = null;
  $("broadcast-highlight").hidden = true;
  document.querySelector(".broadcast").dataset.phase = "ready";
  updateNames();
  updateStats();
  $("clock").textContent = "45";
  $("round-label").textContent = "ROUND 01";
  $("replay").disabled = true;
  $("pause").disabled = true;
  $("broadcast-state").textContent = "赛前准备";
  $("pause").textContent = "Ⅱ 暂停";
  $("feed-counter").textContent = "READY";
  const emptyFeed = document.createElement("li");
  emptyFeed.className = "feed-empty";
  emptyFeed.textContent = "等待第一声开赛铃。";
  $("battle-feed").replaceChildren(emptyFeed);
  $("commentary").textContent =
    `${config(0).name} 对阵 ${config(1).name}。双方已就位，等待开赛。`;
  announce(
    "胜负，即将揭晓。",
    "选好你的选手，开启一场智能对决",
    "THE STAGE IS YOURS",
  );
}

fighters.forEach((f) => {
  const card = document.createElement("button");
  card.className = "roster-card";
  card.dataset.fighter = f.id;
  card.style.setProperty("--fighter", f.color);
  card.setAttribute("aria-label", `选择 ${f.name} 作为一号选手`);
  const icon = document.createElement("span");
  icon.className = "roster-symbol";
  icon.textContent = symbols[f.id];
  const text = document.createElement("span");
  const name = document.createElement("b");
  name.textContent = f.name;
  const title = document.createElement("small");
  title.textContent = f.title;
  text.append(name, title);
  const caption = document.createElement("span");
  caption.className = "roster-caption";
  caption.textContent = f.description;
  const badge = document.createElement("span");
  badge.className = "roster-p1";
  card.append(icon, text, caption, badge);
  card.addEventListener("click", () => {
    if (playing) return;
    players[0].value = f.id;
    tactics[0].value = f.style;
    resetSelection();
  });
  $("fighter-roster").append(card);
});

function tone(frequency = 220, duration = 0.1, type = "sine", volume = 0.04) {
  if (!sound || !audio) return;
  const osc = audio.createOscillator(),
    gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, audio.currentTime);
  osc.frequency.exponentialRampToValueAtTime(
    frequency / 2,
    audio.currentTime + duration,
  );
  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + duration);
}
$("sound").addEventListener("click", async () => {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    await audio.resume();
    sound = !sound;
    $("sound").setAttribute("aria-pressed", String(sound));
    $("sound").setAttribute(
      "aria-label",
      sound ? "关闭比赛音效" : "开启比赛音效",
    );
    $("sound").querySelector("span").textContent = sound ? "音效开" : "音效关";
    tone(660, 0.2);
  } catch {
    $("sound").querySelector("span").textContent = "音效不可用";
  }
});

document.querySelectorAll("[data-camera]").forEach((button) =>
  button.addEventListener("click", () => {
    if (scene) scene.cameraMode = button.dataset.camera;
    document
      .querySelectorAll("[data-camera]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
  }),
);

function lockSettings(locked) {
  [
    ...players,
    ...tactics,
    ...document.querySelectorAll(".roster-card"),
  ].forEach((el) => {
    el.disabled = locked;
  });
}
function beginPlayback() {
  timeline = buildBroadcast(replay);
  elapsed = 0;
  lastBeat = "";
  lastPhase = "";
  finished = false;
  playing = true;
  lastFrame = undefined;
  scene.lastImpact = "";
  scene.pose = null;
  scene.presentation = null;
  scene.paused = false;
  lastCommentary = -Infinity;
  $("broadcast-highlight").hidden = true;
  $("battle-feed").replaceChildren();
  $("feed-counter").textContent = "LIVE";
  $("pause").disabled = false;
  $("pause").textContent = "Ⅱ 暂停";
  $("replay").disabled = false;
  $("start").textContent = "↻ 重新开赛";
  lockSettings(true);
  updateStats();
}

async function startMatch(seed) {
  $("start").disabled = true;
  playing = false;
  $("pause").disabled = true;
  lockSettings(true);
  announce("选手准备中", "正在生成完整赛况…");
  try {
    const response = await fetch("/api/fights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        players: players.map((p) => p.value),
        tactics: tactics.map((p) => p.value),
        ...(seed === undefined ? {} : { seed }),
      }),
    });
    if (!response.ok) throw new Error("比赛生成失败，请重试。");
    replay = await response.json();
    beginPlayback();
  } catch (error) {
    playing = false;
    replay = null;
    $("replay").disabled = true;
    lockSettings(false);
    announce("暂时无法开赛", error.message, "PLEASE TRY AGAIN");
    $("broadcast-state").textContent = "连接异常";
    $("commentary").textContent = "未生成比赛。请检查连接后重新开赛。";
  } finally {
    $("start").disabled = false;
  }
}
$("start").addEventListener("click", () => startMatch());
$("replay").addEventListener("click", () => {
  if (replay) beginPlayback();
});
$("pause").addEventListener("click", () => {
  if (!replay || finished) return;
  playing = !playing;
  $("pause").textContent = playing ? "Ⅱ 暂停" : "▶ 继续";
  $("broadcast-state").textContent = playing ? "比赛继续" : "比赛已暂停";
  lastPhase = "";
  lastFrame = undefined;
});

function feed(text, round, tick) {
  const li = document.createElement("li");
  const label = document.createElement("strong");
  label.textContent = `R${round} · ${String(tick + 1).padStart(2, "0")} `;
  li.append(label, document.createTextNode(text));
  $("battle-feed").prepend(li);
  while ($("battle-feed").children.length > 24)
    $("battle-feed").lastChild.remove();
}
function finish() {
  finished = true;
  playing = false;
  lockSettings(false);
  $("pause").disabled = true;
  $("broadcast-state").textContent = "比赛结束";
  $("feed-counter").textContent = "FINAL";
  $("broadcast-highlight").hidden = true;
  document.querySelector(".broadcast").dataset.phase = "complete";
  scene.pose = null;
  scene.presentation = {
    type: "result",
    states: replay.rounds.at(-1).beats.at(-1).states,
    winner: replay.winner,
  };
  const title =
    replay.winner === null
      ? "势均力敌 · 平局"
      : `${config(replay.winner).name} 获胜`;
  announce(
    title,
    `${replay.wins[0]} : ${replay.wins[1]}  ·  可重播本场，或换位选手再战`,
    "MATCH COMPLETE",
    true,
  );
  $("commentary").textContent =
    replay.winner === null
      ? "双方鏖战三轮，最终握手言和。"
      : `${config(replay.winner).title}拿下本场胜利！这是策略与时机的较量。`;
  tone(880, 0.5, "triangle", 0.06);
  const record = {
    players: replay.players,
    wins: replay.wins,
    seed: replay.seed,
    tactics: replay.tactics,
  };
  if (
    !savedMatches.some(
      (m) =>
        m.seed === record.seed &&
        String(m.players) === String(record.players) &&
        String(m.tactics) === String(record.tactics),
    )
  ) {
    savedMatches.unshift(record);
    savedMatches = savedMatches.slice(0, 8);
    try {
      localStorage.setItem("celestial-matches", JSON.stringify(savedMatches));
    } catch {
      /* Match playback also works without storage. */
    }
  }
  renderHistory();
}
function renderHistory() {
  if (!savedMatches.length) return;
  $("history").replaceChildren();
  savedMatches.forEach((m) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const names = m.players.map((id) => fighters.find((f) => f.id === id).name);
    const name = document.createElement("span");
    name.textContent = `${names[0]}  vs  ${names[1]}`;
    const score = document.createElement("strong");
    score.textContent = `${m.wins[0]} : ${m.wins[1]}`;
    const button = document.createElement("button");
    button.className = "history-replay";
    button.textContent = "回看比赛 ↗";
    button.addEventListener("click", () => {
      if (playing) return;
      players.forEach((p, i) => {
        p.value = m.players[i];
        tactics[i].value = m.tactics[i];
      });
      resetSelection();
      startMatch(m.seed);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    row.append(name, score, button);
    $("history").append(row);
  });
}
function frame(now) {
  // Keep the match on wall-clock time even on slower renderers. Hidden tabs
  // explicitly pause below, so no capped delta should silently slow playback.
  const dt = Math.max(0, (now - (lastFrame ?? now)) / 1000);
  lastFrame = now;
  if (scene) {
    scene.paused = Boolean(replay && !playing && !finished);
    document.querySelector(".broadcast").dataset.paused = String(scene.paused);
  }
  if (playing && replay && scene) {
    elapsed += dt * Number($("speed").value);
    const shot = broadcastAt(timeline, elapsed);
    document.querySelector(".broadcast").dataset.phase = shot.type;
    $("broadcast-highlight").hidden = !shot.slowMotion;
    if (shot.type === "complete") finish();
    else if (shot.type === "entrance") {
      scene.pose = null;
      scene.presentation = shot;
      if (lastPhase !== `entrance${shot.player}`) {
        lastPhase = `entrance${shot.player}`;
        const f = config(shot.player);
        announce(
          `${f.name} · ${f.title}`,
          `${styles[tactics[shot.player].value]}  /  绝技「${f.skill}」`,
          `P${shot.player + 1} ENTRANCE / ${f.provider.toUpperCase()}`,
        );
        $("center-announcement").dataset.kind = "entrance";
        $("center-announcement").style.setProperty("--intro-color", f.color);
        $("broadcast-state").textContent = "选手入场";
        $("commentary").textContent = `${f.name}，${f.title}，登场！${f.description}。`;
        $("clock").textContent = "45";
        $("round-label").textContent = "ROUND 01";
        $("feed-counter").textContent = "ENTRANCE";
        tone(shot.player ? 660 : 440, 0.3, "triangle");
      }
    } else {
      const { round } = shot;
      const previousWins = round.round > 1
        ? replay.rounds[round.round - 2].wins
        : [0, 0];
      $("round-label").textContent =
        `ROUND ${String(round.round).padStart(2, "0")}`;
      if (shot.type === "countdown") {
        scene.pose = null;
        scene.presentation = null;
        const count = Math.min(3, Math.floor(shot.progress * 3.8));
        const key = `countdown${round.round}-${count}`;
        if (lastPhase !== key) {
          lastPhase = key;
          updateStats(undefined, previousWins);
          announce(
            count === 3 ? "开战！" : String(3 - count),
            `${config(0).name}  VS  ${config(1).name}`,
            `ROUND ${round.round} / ${count === 3 ? "FIGHT" : "READY"}`,
          );
          $("center-announcement").dataset.kind = "countdown";
          $("broadcast-state").textContent = "开赛倒计时";
          $("clock").textContent = "45";
          $("feed-counter").textContent = "COUNTDOWN";
          $("commentary").textContent = count === 3
            ? `第 ${round.round} 回合，开战！`
            : `第 ${round.round} 回合即将开始。当前比分 ${previousWins[0]} : ${previousWins[1]}，双方准备就绪。`;
          tone(count === 3 ? 880 : 540, count === 3 ? 0.35 : 0.1, "triangle");
        }
      } else if (shot.type === "fight") {
        const { index, progress, beat } = shot;
        const key = `${round.round}-${index}`;
        scene.presentation = { type: "fight", slowMotion: shot.slowMotion };
        scene.setPose(
          index ? round.beats[index - 1].states : [{ x: -2.1 }, { x: 2.1 }],
          beat,
          progress,
          key,
        );
        $("center-announcement").classList.add("hidden");
        $("broadcast-state").textContent = "比赛进行中";
        $("clock").textContent = Math.max(0, 45 - index);
        if (lastBeat !== key && progress >= 0.37) {
          lastBeat = key;
          updateStats(beat.states, previousWins);
          const special = beat.events.find((e) => e.action === "ultimate");
          let line;
          if (special)
            line = `${config(special.player).name} 释放「${config(special.player).skill}」！${special.outcome === "block" ? "对手及时格挡。" : special.outcome === "evade" ? "被惊险闪过！" : `造成 ${special.damage} 点伤害！`}`;
          else {
            const e = beat.events.find((e) => e.damage > 4) ?? beat.events[0];
            line = e
              ? `${config(e.player).name} ${actionNames[e.action]}，${e.outcome === "miss" ? "距离不足，未命中。" : e.outcome === "evade" ? "被对手闪避！" : e.outcome === "block" ? "被成功格挡。" : `命中！造成 ${e.damage} 点伤害。`}`
              : `${actionNames[beat.actions[0]]} 对上 ${actionNames[beat.actions[1]]}，双方寻找破绽。`;
          }
          // Keep normal calls readable; key hits interrupt and receive their
          // own slow-motion hold. The detailed feed still logs every exchange.
          if (shot.keyHit || elapsed - lastCommentary >= 2.8) {
            $("commentary").textContent = line;
            lastCommentary = elapsed;
          }
          feed(line, round.round, index);
          $("feed-counter").textContent = `${index + 1} EXCHANGES`;
          beat.events.forEach((e) => {
            if (!e.damage) return;
            const el = $(`damage-${1 - e.player}`);
            el.textContent = e.outcome === "block" ? "格挡" : `−${e.damage}`;
            el.classList.remove("pop");
            void el.offsetWidth;
            el.classList.add("pop");
          });
          if (beat.events.some((e) => e.damage))
            tone(
              special ? 160 : 110,
              special ? 0.35 : 0.09,
              "triangle",
              special ? 0.07 : 0.035,
            );
        }
      } else if (shot.type === "outro") {
        scene.pose = null;
        scene.presentation = {
          type: "outro",
          states: round.beats.at(-1).states,
          winner: round.winner,
        };
        if (lastPhase !== `outro${round.round}`) {
          lastPhase = `outro${round.round}`;
          updateStats(round.beats.at(-1).states, round.wins);
          const result = round.winner === null
            ? "本轮平局"
            : `${config(round.winner).name} 拿下本轮`;
          const score = `${round.wins[0]} : ${round.wins[1]}`;
          announce(roundCall(round), `${result}  ·  总比分 ${score}`, `ROUND ${round.round} COMPLETE`);
          $("center-announcement").dataset.kind = "outro";
          $("broadcast-state").textContent = "回合结束";
          $("feed-counter").textContent = "ROUND COMPLETE";
          $("commentary").textContent = `${result}！当前比分 ${score}。${round === replay.rounds.at(-1) ? "胜负已定，等待最终赛果。" : "稍作调整，准备下一回合。"}`;
          tone(330, 0.4, "triangle");
        }
      }
    }
  }
  requestAnimationFrame(frame);
}
updateNames();
renderHistory();
$("start").disabled = true;
try {
  const { FightScene } = await import("./fight-scene.js");
  scene = new FightScene(
    $("scene"),
    players.map((_, i) => config(i)),
  );
  $("loading-scene").remove();
  $("start").disabled = false;
  updateNames();
  $("scene").addEventListener("rendererror", () => {
    playing = false;
    $("start").disabled = true;
    $("pause").disabled = true;
    announce("3D 画面已中断", "请刷新页面重新连接渲染器。", "RENDERER OFFLINE");
  });
} catch (error) {
  $("loading-scene").textContent =
    "此浏览器暂时无法启用 3D。请使用支持 WebGL 的 Chrome、Edge 或 Firefox。";
  $("center-announcement").classList.add("hidden");
  $("commentary").textContent =
    "无法初始化 3D 渲染器。请启用浏览器硬件加速后刷新。";
  console.error("3D initialization failed:", error);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing) $("pause").click();
});
// Browser history may restore native select values after module initialization.
// Synchronize all dependent visuals after that restoration, including BFCache.
window.addEventListener("pageshow", () => {
  if (!replay) resetSelection();
  else updateNames();
});
requestAnimationFrame(frame);
