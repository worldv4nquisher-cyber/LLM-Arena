import { fighters, styles, actionNames } from "./fight-engine.js";
import { CONTACT, ROUND_INTRO, ROUND_OUTRO, playbackCues, advancePlayback } from "./fight-choreography.js";
import { ArenaAudio } from "./fight-audio.js";

const venueAudio = new ArenaAudio();

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
  elapsed = 0,
  playing = false,
  lastFrame,
  lastBeat = "",
  lastPhase = "",
  finished = false,
  loading = false;
let combatCues = [];
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
  updateNames();
  updateStats();
  $("clock").textContent = "45";
  $("round-label").textContent = "ROUND 01";
  $("replay").disabled = true;
  $("pause").disabled = true;
  $("broadcast-state").textContent = "赛前准备";
  $("pause").textContent = "Ⅱ 暂停";
  $("start").textContent = "▶ 开始比赛";
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

$("sound").addEventListener("click", async () => {
  $("sound").disabled = true;
  try {
    const sound = await venueAudio.toggle();
    $("sound").setAttribute("aria-pressed", String(sound));
    $("sound").setAttribute(
      "aria-label",
      sound ? "关闭比赛音效" : "开启比赛音效",
    );
    $("sound").querySelector("span").textContent = sound ? "音效开" : "音效关";
    if (sound) venueAudio.bell();
  } catch {
    $("sound").querySelector("span").textContent = "音效不可用";
  } finally {
    $("sound").disabled = false;
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
  combatCues = playbackCues(replay);
  elapsed = 0;
  lastBeat = "";
  lastPhase = "";
  finished = false;
  playing = true;
  lastFrame = undefined;
  scene.resetPose();
  $("battle-feed").replaceChildren();
  $("feed-counter").textContent = "LIVE";
  $("pause").disabled = false;
  $("pause").textContent = "Ⅱ 暂停";
  $("replay").disabled = false;
  $("start").textContent = "↻ 重新开赛";
  $("round-label").textContent = "ROUND 01";
  $("clock").textContent = "45";
  $("broadcast-state").textContent = "回合准备";
  $("commentary").textContent =
    `${config(0).name} 对阵 ${config(1).name}。比赛即将开始。`;
  lockSettings(true);
  updateStats();
}

function updateHistoryControls() {
  document.querySelectorAll(".history-replay").forEach((button) => {
    button.disabled = loading || !scene;
  });
}

async function startMatch(seed) {
  if (loading || !scene) return;
  loading = true;
  $("start").disabled = true;
  $("edit-settings").disabled = true;
  $("replay").disabled = true;
  updateHistoryControls();
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
    loading = false;
    $("start").disabled = false;
    $("edit-settings").disabled = false;
    updateHistoryControls();
  }
}
function watchMatch() {
  if (window.matchMedia("(max-width: 800px)").matches)
    $("broadcast").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("start").addEventListener("click", () => {
  startMatch();
  watchMatch();
});
$("edit-settings").addEventListener("click", () => {
  if (loading) return;
  playing = false;
  lockSettings(false);
  resetSelection();
  $("match-setup").scrollIntoView({ behavior: "smooth", block: "start" });
  players[0].focus({ preventScroll: true });
});
$("replay").addEventListener("click", () => {
  if (replay && !loading) {
    beginPlayback();
    watchMatch();
  }
});
$("pause").addEventListener("click", () => {
  if (!replay || finished) return;
  playing = !playing;
  $("pause").textContent = playing ? "Ⅱ 暂停" : "▶ 继续";
  $("broadcast-state").textContent = playing ? "比赛进行中" : "比赛已暂停";
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
  scene.setResult(replay.rounds.at(-1).beats.at(-1).states, replay.winner);
  lockSettings(false);
  $("pause").disabled = true;
  $("broadcast-state").textContent = "比赛结束";
  $("feed-counter").textContent = "FINAL";
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
  venueAudio.victory();
  scene.stage.react(1.8);
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
    button.setAttribute(
      "aria-label",
      `回看 ${names[0]} 对阵 ${names[1]}，${m.wins[0]} 比 ${m.wins[1]}`,
    );
    button.addEventListener("click", () => {
      if (loading || !scene) return;
      playing = false;
      players.forEach((p, i) => {
        p.value = m.players[i];
        tactics[i].value = m.tactics[i];
      });
      resetSelection();
      startMatch(m.seed);
      $("broadcast").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    row.append(name, score, button);
    $("history").append(row);
  });
  updateHistoryControls();
}
function frame(now) {
  // Normal playback follows wall-clock time. Stalled renderers still show the
  // decisive contact and follow-through instead of skipping entire exchanges.
  const dt = Math.max(0, (now - (lastFrame ?? now)) / 1000);
  lastFrame = now;
  venueAudio.setPaused(document.hidden || Boolean(replay && !playing && !finished));
  if (playing && replay && scene) {
    elapsed = advancePlayback(elapsed, dt * Number($("speed").value), combatCues, dt);
    let position = elapsed,
      active = false;
    for (const round of replay.rounds) {
      const intro = ROUND_INTRO,
        duration = round.beats.length * replay.beatDuration,
        outro = ROUND_OUTRO;
      const roundDuration = intro + duration + outro;
      if (position >= roundDuration) {
        position -= roundDuration;
        continue;
      }
      active = true;
      $("round-label").textContent =
        `ROUND ${String(round.round).padStart(2, "0")}`;
      if (position < intro) {
        if (lastPhase !== `intro${round.round}`) {
          lastPhase = `intro${round.round}`;
          scene.resetPose();
          updateStats(
            undefined,
            round.round > 1 ? replay.rounds[round.round - 2].wins : [0, 0],
          );
          announce(
            `ROUND ${round.round}`,
            `${config(0).name}  VS  ${config(1).name}`,
            "READY TO FIGHT",
          );
          $("broadcast-state").textContent = "回合准备";
          $("clock").textContent = "45";
          venueAudio.bell();
        }
      } else if (position < intro + duration) {
        const time = position - intro,
          index = Math.floor(time / replay.beatDuration),
          progress = time / replay.beatDuration - index,
          beat = round.beats[index];
        const key = `${round.round}-${index}`;
        scene.setPose(
          index ? round.beats[index - 1].states : [{ x: -2.1 }, { x: 2.1 }],
          beat,
          progress,
          key,
        );
        $("center-announcement").classList.add("hidden");
        $("broadcast-state").textContent = "比赛进行中";
        $("clock").textContent = Math.max(0, 45 - index);
        if (lastBeat !== key && progress >= CONTACT) {
          lastBeat = key;
          updateStats(
            beat.states,
            round.round > 1 ? replay.rounds[round.round - 2].wins : [0, 0],
          );
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
          $("commentary").textContent = line;
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
          venueAudio.exchange(beat.events);
        }
      } else if (lastPhase !== `outro${round.round}`) {
        lastPhase = `outro${round.round}`;
        scene.setResult(round.beats.at(-1).states, round.winner);
        updateStats(round.beats.at(-1).states, round.wins);
        announce(
          round.winner === null
            ? "DOUBLE K.O."
            : round.beats.at(-1).states[1 - round.winner].hp === 0
              ? "K.O."
              : "TIME UP",
          round.winner === null
            ? "本轮平局"
            : `${config(round.winner).name} 拿下本轮`,
          `ROUND ${round.round} COMPLETE`,
        );
        venueAudio.knockout();
        scene.stage.react(1.8);
      }
      break;
    }
    if (!active) finish();
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
  updateHistoryControls();
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
  venueAudio.setPaused(document.hidden || Boolean(replay && !playing && !finished));
});
// Browser history may restore native select values after module initialization.
// Synchronize all dependent visuals after that restoration, including BFCache.
window.addEventListener("pageshow", () => {
  if (!replay) resetSelection();
  else updateNames();
});
requestAnimationFrame(frame);
