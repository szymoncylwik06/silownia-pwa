"use strict";

const LEGACY_STORE_KEY = "silownia-local-v1";
// Adres wlasciciela uzywany tylko przy migracji danych za Cloudflare Access.
// W deployu prywatnym mozna nadpisac przez window.SILOWNIA_OWNER_EMAIL.
const OWNER_EMAIL = (typeof window !== "undefined" && window.SILOWNIA_OWNER_EMAIL) || "owner@example.com";
let STORE_KEY = LEGACY_STORE_KEY;
let SCHEMA_KEY = `${STORE_KEY}-schema`;
const SCHEMA_VERSION = 2;
let currentIdentity = "local";

const CATEGORIES = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core"];
const CATEGORY_COLORS = {
  Chest: "#6fd97c",
  Back: "#5fcfcb",
  Legs: "#f1955a",
  Shoulders: "#7aa9e0",
  Arms: "#b48cdb",
  Core: "#e6b73e"
};
const TARGET_RANGES = {
  Chest: { min: 10, max: 16 },
  Back: { min: 12, max: 18 },
  Legs: { min: 10, max: 16 },
  Shoulders: { min: 8, max: 14 },
  Arms: { min: 8, max: 14 },
  Core: { min: 6, max: 12 }
};
const DEFAULT_REST_WORKOUT = 120;
const DEFAULT_REST_TEMPLATE = 90;
const SAVE_DEBOUNCE_MS = 400;
const TOAST_DURATION_MS = 1800;
const UNDO_DURATION_MS = 6000;
const STANDARD_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
const DEFAULT_BAR_WEIGHT = 20;
const DEFAULT_EXERCISES = {
  Chest: ["Bench Press","Cable Fly","Chest Press Machine","Dips","Dumbbell Bench Press","Dumbbell Fly","Incline Bench Press","Incline Dumbbell Press","Pec Deck","Push-up"],
  Back: ["Barbell Row","Chest Supported Row","Deadlift","Dumbbell Row","Lat Pulldown","Machine Row","Pull-up","Seated Cable Row","Straight Arm Pulldown","T-Bar Row"],
  Legs: ["Bulgarian Split Squat","Calf Raise","Hack Squat","Hip Thrust","Leg Curl","Leg Extension","Leg Press","Romanian Deadlift","Squat","Walking Lunges"],
  Shoulders: ["Arnold Press","Cable Lateral Raise","Dumbbell Shoulder Press","Face Pull","Front Raise","Lateral Raise","Machine Shoulder Press","Overhead Press","Rear Delt Fly","Upright Row"],
  Arms: ["Barbell Curl","Cable Curl","Close Grip Bench Press","Dips","Dumbbell Curl","Hammer Curl","Overhead Triceps Extension","Preacher Curl","Skull Crusher","Triceps Pushdown"],
  Core: ["Ab Wheel","Cable Crunch","Crunch","Dead Bug","Hanging Leg Raise","Mountain Climbers","Pallof Press","Plank","Russian Twist","Side Plank"]
};
const ROUTES = ["home", "history", "start", "profile"];

if (typeof globalThis.structuredClone !== "function") {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

const app = document.querySelector("#app");

const DEFAULT_EXERCISES_LIST = CATEGORIES.flatMap((category) =>
  DEFAULT_EXERCISES[category].map((name) => ({
    id: `ex-${slug(name)}`,
    name,
    category,
    isDefault: true,
    notes: "",
    imageType: category
  }))
);

let exerciseMapCache = null;
let weeklyVolumeCache = null;
let weeklyVolumeStamp = "";

let state = defaultState();
let ui = {
  route: state.activeWorkout ? "start" : "home",
  historyView: "calendar",
  historySearch: "",
  selectedDate: toDateKey(new Date()),
  viewedMonth: new Date().getMonth(),
  viewedYear: new Date().getFullYear(),
  selectedExerciseId: "ex-bench-press",
  selectedMuscle: "Chest",
  bodyView: "front",
  catalogCategory: "Chest",
  catalogSearch: "",
  modal: null,
  toast: "",
  toastAction: null,
  restTimer: null,
  expandedSet: null,
  lastFocusBeforeModal: null,
  linking: null,
  drag: null
};

let restInterval = null;
let liveHeaderInterval = null;
let toastTimeout = null;
let saveTimeout = null;
let undoSnapshot = null;
let undoTimeout = null;

function slug(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toLocalDateTime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}:${s}`;
}

function formatDate(dateKey) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${dateKey}T12:00:00`)
  );
}

function formatMonth(year, month) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(year, month, 1));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getRange(category) {
  return state.profile.weeklyRanges[category] || TARGET_RANGES[category];
}

function defaultState() {
  const today = new Date();
  const day = today.getDate();
  const yyyy = today.getFullYear();
  const mm = today.getMonth();
  const d = (offset) => toDateKey(new Date(yyyy, mm, Math.max(1, day + offset)));
  return {
    profile: {
      name: "Demo",
      goal: "Hypertrophy",
      bodyWeight: 80,
      barWeight: DEFAULT_BAR_WEIGHT,
      notifications: false,
      weeklyRanges: structuredClone(TARGET_RANGES)
    },
    customExercises: [],
    templates: [
      {
        id: uid("tpl"),
        name: "Upper A",
        notes: "Siła + objętość góry",
        exercises: [
          { exerciseId: "ex-bench-press", targetSets: 4, repsMin: 6, repsMax: 8, restSeconds: DEFAULT_REST_WORKOUT },
          { exerciseId: "ex-barbell-row", targetSets: 4, repsMin: 8, repsMax: 10, restSeconds: DEFAULT_REST_WORKOUT },
          { exerciseId: "ex-lateral-raise", targetSets: 3, repsMin: 12, repsMax: 15, restSeconds: 75 }
        ]
      },
      {
        id: uid("tpl"),
        name: "Lower A",
        notes: "Nogi bez kombinowania",
        exercises: [
          { exerciseId: "ex-squat", targetSets: 4, repsMin: 5, repsMax: 8, restSeconds: 150 },
          { exerciseId: "ex-romanian-deadlift", targetSets: 3, repsMin: 8, repsMax: 10, restSeconds: DEFAULT_REST_WORKOUT },
          { exerciseId: "ex-calf-raise", targetSets: 4, repsMin: 10, repsMax: 15, restSeconds: 60 }
        ]
      }
    ],
    sessions: [
      sampleSession("Upper A", d(-16), [
        ["ex-bench-press", [[77.5, 8], [77.5, 7], [75, 8]]],
        ["ex-barbell-row", [[70, 10], [70, 9], [67.5, 10]]]
      ]),
      sampleSession("Lower A", d(-12), [
        ["ex-squat", [[100, 7], [100, 6], [95, 8]]],
        ["ex-romanian-deadlift", [[95, 8], [95, 8], [90, 9]]]
      ]),
      sampleSession("Upper A", d(-7), [
        ["ex-bench-press", [[80, 8], [80, 7], [77.5, 8], [77.5, 7]]],
        ["ex-lat-pulldown", [[65, 10], [65, 9], [60, 11]]],
        ["ex-lateral-raise", [[12, 14], [12, 13], [10, 15]]]
      ]),
      sampleSession("Manual Workout", d(-2), [
        ["ex-dumbbell-curl", [[16, 10], [16, 9], [14, 11]]],
        ["ex-triceps-pushdown", [[35, 12], [35, 11], [32.5, 12]]],
        ["ex-cable-crunch", [[45, 12], [45, 12], [45, 10]]]
      ])
    ],
    activeWorkout: null
  };
}

function sampleSession(name, dateKey, exerciseSets) {
  const startedAt = `${dateKey}T17:30:00`;
  const finishedAt = `${dateKey}T18:42:00`;
  return {
    id: uid("ses"),
    name,
    templateId: name === "Manual Workout" ? null : uid("tpl-ref"),
    startedAt,
    finishedAt,
    notes: "",
    exercises: exerciseSets.map(([exerciseId, sets]) => ({
      id: uid("wex"),
      exerciseId,
      restSeconds: DEFAULT_REST_WORKOUT,
      unilateral: false,
      groupId: null,
      notes: "",
      sets: sets.map(([weight, reps], index) => ({
        id: uid("set"),
        setNumber: index + 1,
        weight,
        reps,
        completed: true,
        rir: null,
        notes: ""
      }))
    }))
  };
}

function migrateRaw(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.schema && parsed.data) return runMigrations(parsed.schema, parsed.data);
  return runMigrations(1, parsed);
}

function runMigrations(fromVersion, data) {
  let current = data;
  let version = fromVersion;
  if (version === 1) {
    current = migrateV1ToV2(current);
    version = 2;
  }
  return current;
}

function migrateV1ToV2(data) {
  const next = { ...data };
  if (next.profile && typeof next.profile === "object") {
    next.profile = {
      ...next.profile,
      barWeight: Number.isFinite(Number(next.profile.barWeight)) ? Number(next.profile.barWeight) : DEFAULT_BAR_WEIGHT,
      notifications: Boolean(next.profile.notifications)
    };
  }
  const ensureExerciseShape = (we) => ({
    id: we.id || uid("wex"),
    exerciseId: String(we.exerciseId || ""),
    restSeconds: Number.isFinite(Number(we.restSeconds)) ? Number(we.restSeconds) : DEFAULT_REST_WORKOUT,
    unilateral: Boolean(we.unilateral),
    groupId: we.groupId || null,
    notes: String(we.notes || ""),
    sets: Array.isArray(we.sets) ? we.sets.map(ensureSetShape) : []
  });
  const ensureSetShape = (set, index) => ({
    id: set.id || uid("set"),
    setNumber: Number.isFinite(Number(set.setNumber)) ? Number(set.setNumber) : index + 1,
    weight: set.weight ?? "",
    reps: set.reps ?? "",
    repsLeft: set.repsLeft ?? "",
    repsRight: set.repsRight ?? "",
    completed: Boolean(set.completed),
    rir: set.rir == null ? null : Number(set.rir),
    notes: String(set.notes || "")
  });
  if (Array.isArray(next.sessions)) {
    next.sessions = next.sessions.map((s) => ({
      ...s,
      exercises: Array.isArray(s.exercises) ? s.exercises.map(ensureExerciseShape) : []
    }));
  }
  if (next.activeWorkout && Array.isArray(next.activeWorkout.exercises)) {
    next.activeWorkout = {
      ...next.activeWorkout,
      exercises: next.activeWorkout.exercises.map(ensureExerciseShape)
    };
  }
  return next;
}

function sanitizeState(loaded) {
  const base = defaultState();
  const profile = { ...base.profile, ...(loaded?.profile || {}) };
  profile.weeklyRanges = { ...base.profile.weeklyRanges, ...(loaded?.profile?.weeklyRanges || {}) };
  CATEGORIES.forEach((cat) => {
    const range = profile.weeklyRanges[cat] || base.profile.weeklyRanges[cat];
    profile.weeklyRanges[cat] = {
      min: Math.max(0, Number(range.min ?? base.profile.weeklyRanges[cat].min)),
      max: Math.max(1, Number(range.max ?? base.profile.weeklyRanges[cat].max))
    };
  });
  profile.bodyWeight = Number.isFinite(Number(profile.bodyWeight)) ? Number(profile.bodyWeight) : 0;
  profile.barWeight = Number.isFinite(Number(profile.barWeight)) ? Number(profile.barWeight) : DEFAULT_BAR_WEIGHT;
  profile.notifications = Boolean(profile.notifications);
  return {
    profile,
    customExercises: Array.isArray(loaded?.customExercises) ? loaded.customExercises.filter((e) => e && e.id && e.name) : [],
    templates: Array.isArray(loaded?.templates) ? loaded.templates.filter((t) => t && t.id && t.name && Array.isArray(t.exercises)) : [],
    sessions: Array.isArray(loaded?.sessions) ? loaded.sessions.filter((s) => s && s.id && s.startedAt && Array.isArray(s.exercises)) : [],
    activeWorkout: loaded?.activeWorkout && Array.isArray(loaded.activeWorkout.exercises) ? loaded.activeWorkout : null
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const migrated = migrateRaw(raw);
    if (!migrated) return defaultState();
    return sanitizeState(migrated);
  } catch {
    return defaultState();
  }
}

function slugifyEmail(email) {
  return String(email || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function storageKeyFor(identity) {
  if (!identity || identity === "local") return LEGACY_STORE_KEY;
  return `silownia-${slugifyEmail(identity)}-v1`;
}

async function getIdentity() {
  if (typeof location !== "undefined" && location.pathname.endsWith("test.html")) return "local";
  if (typeof fetch !== "function") return "local";
  try {
    const res = await fetch("/cdn-cgi/access/get-identity", { credentials: "include", cache: "no-store" });
    if (!res.ok) return "local";
    const data = await res.json();
    const email = data && (data.email || data.user_email || data.name);
    return email ? String(email).toLowerCase() : "local";
  } catch {
    return "local";
  }
}

function migrateLegacyIfNeeded() {
  if (currentIdentity === "local") return;
  if (currentIdentity !== OWNER_EMAIL) return;
  if (STORE_KEY === LEGACY_STORE_KEY) return;
  try {
    const legacy = localStorage.getItem(LEGACY_STORE_KEY);
    if (!legacy) return;
    if (localStorage.getItem(STORE_KEY)) return;
    localStorage.setItem(STORE_KEY, legacy);
  } catch {}
}

function saveStateNow() {
  try {
    const payload = JSON.stringify({ schema: SCHEMA_VERSION, data: state });
    localStorage.setItem(STORE_KEY, payload);
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
  } catch (err) {
    console.error("saveStateNow failed", err);
  }
}

function queueSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveStateNow, SAVE_DEBOUNCE_MS);
}

function flushSave() {
  if (saveTimeout) saveStateNow();
}

function invalidateExerciseCache() {
  exerciseMapCache = null;
}

function invalidateVolumeCache() {
  weeklyVolumeCache = null;
}

function exerciseMap() {
  if (!exerciseMapCache) {
    exerciseMapCache = new Map();
    DEFAULT_EXERCISES_LIST.forEach((e) => exerciseMapCache.set(e.id, e));
    state.customExercises.forEach((e) => exerciseMapCache.set(e.id, e));
  }
  return exerciseMapCache;
}

function allExercises() {
  return [...exerciseMap().values()];
}

function getExercise(id) {
  return exerciseMap().get(id) || null;
}

function exercisesByCategory(category, search = "") {
  const normalized = search.trim().toLowerCase();
  const items = allExercises().filter((exercise) => {
    if (exercise.category !== category) return false;
    if (!normalized) return true;
    return exercise.name.toLowerCase().includes(normalized);
  });
  const sorter = (a, b) => a.name.localeCompare(b.name);
  return {
    defaults: items.filter((e) => e.isDefault).sort(sorter),
    customs: items.filter((e) => !e.isDefault).sort(sorter)
  };
}

function sessionDate(session) {
  return session.startedAt.slice(0, 10);
}

function setsForSessionExercise(workoutExercise) {
  return workoutExercise.sets.filter((set) => set.completed && effectiveSetReps(set) > 0);
}

function effectiveSetReps(set) {
  if (set.repsLeft || set.repsRight) {
    return Math.min(Number(set.repsLeft || 0), Number(set.repsRight || 0));
  }
  return Number(set.reps || 0);
}

function sessionVolume(session) {
  return session.exercises.reduce(
    (sum, we) =>
      sum +
      setsForSessionExercise(we).reduce(
        (s, set) => s + Number(set.weight || 0) * effectiveSetReps(set),
        0
      ),
    0
  );
}

function workoutDurationMinutes(session) {
  const start = new Date(session.startedAt);
  const finish = new Date(session.finishedAt || session.startedAt);
  return Math.max(1, Math.round((finish - start) / 60000));
}

function weeklyVolumeStampNow() {
  const sessionsLen = state.sessions.length;
  const lastFinish = state.sessions[state.sessions.length - 1]?.finishedAt || "";
  const activeSets = state.activeWorkout
    ? state.activeWorkout.exercises.reduce((sum, we) => sum + we.sets.filter((s) => s.completed).length, 0)
    : 0;
  return `${sessionsLen}|${lastFinish}|${activeSets}`;
}

function weeklyVolume() {
  const stamp = weeklyVolumeStampNow();
  if (weeklyVolumeCache && weeklyVolumeStamp === stamp) return weeklyVolumeCache;
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 7);
  const volume = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  state.sessions.forEach((session) => {
    const date = new Date(session.startedAt);
    if (date < monday || date >= sunday) return;
    session.exercises.forEach((we) => {
      const exercise = getExercise(we.exerciseId);
      if (!exercise) return;
      volume[exercise.category] += setsForSessionExercise(we).length;
    });
  });
  if (state.activeWorkout) {
    state.activeWorkout.exercises.forEach((we) => {
      const exercise = getExercise(we.exerciseId);
      if (!exercise) return;
      volume[exercise.category] += setsForSessionExercise(we).length;
    });
  }
  weeklyVolumeCache = volume;
  weeklyVolumeStamp = stamp;
  return volume;
}

function volumeStatus(category, sets) {
  const range = getRange(category);
  if (sets >= range.max) return "high";
  if (sets >= range.min) return "mid";
  return "low";
}

function volumePercent(category, sets) {
  const range = getRange(category);
  return Math.min(100, Math.round((sets / range.max) * 100));
}

function oneRm(weight, reps) {
  return Number(weight || 0) * (1 + Number(reps || 0) / 30);
}

function bestOneRmForExercise(exerciseId, excludeSetId = null) {
  let best = 0;
  let bestSet = null;
  const consider = (we) => {
    if (we.exerciseId !== exerciseId) return;
    we.sets.forEach((set) => {
      if (set.id === excludeSetId) return;
      if (!set.completed) return;
      const v = oneRm(set.weight, effectiveSetReps(set));
      if (v > best) { best = v; bestSet = set; }
    });
  };
  state.sessions.forEach((s) => s.exercises.forEach(consider));
  if (state.activeWorkout) state.activeWorkout.exercises.forEach(consider);
  return { value: best, set: bestSet };
}

function isPersonalRecord(exerciseId, set) {
  const w = Number(set.weight || 0);
  const r = effectiveSetReps(set);
  if (w <= 0 || r <= 0 || !set.completed) return false;
  const newOneRm = oneRm(w, r);
  const previous = bestOneRmForExercise(exerciseId, set.id).value;
  return newOneRm > previous && previous > 0;
}

function suggestNextSet(exerciseId) {
  const last = recentExerciseSessions(exerciseId, 1)[0]?.workoutExercise;
  if (!last) return null;
  const lastSet = [...last.sets].reverse().find((s) => s.completed && Number(s.weight) > 0 && effectiveSetReps(s) > 0);
  if (!lastSet) return null;
  const weight = Number(lastSet.weight);
  const reps = effectiveSetReps(lastSet);
  return {
    weightPlus: Math.round((weight + 2.5) * 100) / 100,
    repsSame: reps,
    weightSame: weight,
    repsPlus: reps + 1,
    last: { weight, reps }
  };
}

function calculatePlates(targetWeight, barWeight = state.profile.barWeight || DEFAULT_BAR_WEIGHT) {
  const total = Number(targetWeight);
  if (!Number.isFinite(total) || total <= barWeight) {
    return { perSide: 0, plates: [], leftover: 0, total, barWeight };
  }
  const perSide = (total - barWeight) / 2;
  let remaining = perSide;
  const plates = [];
  for (const p of STANDARD_PLATES) {
    let count = 0;
    while (remaining >= p - 0.001) {
      remaining -= p;
      count += 1;
    }
    if (count > 0) plates.push({ weight: p, count });
  }
  return { perSide, plates, leftover: Math.round(remaining * 1000) / 1000, total, barWeight };
}

function recentExerciseSessions(exerciseId, limit = 5) {
  const activeStarted = state.activeWorkout?.startedAt || toLocalDateTime(new Date());
  return state.sessions
    .filter((s) => s.startedAt < activeStarted)
    .map((s) => ({ session: s, workoutExercise: s.exercises.find((we) => we.exerciseId === exerciseId) }))
    .filter((item) => item.workoutExercise)
    .sort((a, b) => b.session.startedAt.localeCompare(a.session.startedAt))
    .slice(0, limit);
}

function previousSetLabel(exerciseId, setIndex) {
  const previousExercise = recentExerciseSessions(exerciseId, 1)[0]?.workoutExercise;
  const previousSet = previousExercise?.sets?.[setIndex];
  if (!previousSet || !previousSet.weight || !previousSet.reps) return "—";
  return `${previousSet.weight} kg × ${previousSet.reps}`;
}

function bestSetLabel(workoutExercise) {
  const sets = workoutExercise?.sets || [];
  if (!sets.length) return "No sets";
  const best = sets.reduce((top, set) => {
    const cur = Number(set.weight || 0) * Number(set.reps || 0);
    const tv = Number(top.weight || 0) * Number(top.reps || 0);
    return cur > tv ? set : top;
  }, sets[0]);
  return `${best.weight || 0} kg × ${best.reps || 0}`;
}

function exerciseInfo(exercise) {
  if (!exercise) return { summary: "", instructions: [] };
  const base = {
    Chest: { summary: "Pressing or fly movement focused on chest volume.", instructions: ["Set your shoulder blades before the first rep.","Use a controlled eccentric.","Stop the set when form starts breaking."] },
    Back: { summary: "Pulling movement focused on back volume.", instructions: ["Start each rep from a stable torso.","Pull with elbows, not hands.","Avoid momentum near failure."] },
    Legs: { summary: "Lower-body movement counted toward weekly leg volume.", instructions: ["Brace before every rep.","Keep the movement path consistent.","Log working sets only."] },
    Shoulders: { summary: "Shoulder movement focused on delts and pressing stability.", instructions: ["Use controlled reps.","Avoid shrugging through the full set.","Keep range consistent."] },
    Arms: { summary: "Direct arm work for biceps or triceps volume.", instructions: ["Keep elbows stable.","Control the negative.","Do not chase weight at the cost of range."] },
    Core: { summary: "Core movement counted toward weekly trunk volume.", instructions: ["Keep ribs down.","Move slowly.","Stop when the lower back takes over."] }
  };
  return base[exercise.category] || base.Chest;
}

function formatExerciseDisplayName(exercise) {
  if (!exercise) return "Exercise";
  const aliases = {
    "Lat Pulldown": "Lat Pulldown (Cable)",
    "Seated Cable Row": "Seated Row (Cable)",
    "Triceps Pushdown": "Triceps Pushdown (Cable)",
    "Dumbbell Bench Press": "Bench Press (Dumbbell)",
    "Incline Dumbbell Press": "Incline Press (Dumbbell)",
    "Dumbbell Shoulder Press": "Shoulder Press (Dumbbell)",
    "Dumbbell Row": "Row (Dumbbell)",
    "Dumbbell Curl": "Curl (Dumbbell)"
  };
  return aliases[exercise.name] || exercise.name;
}

function timerFor(workoutExerciseId) {
  if (!ui.restTimer || ui.restTimer.workoutExerciseId !== workoutExerciseId) return 0;
  return Math.max(0, ui.restTimer.remaining);
}

function formatRestShort(seconds) {
  const value = Number(seconds || 0);
  const min = Math.floor(value / 60);
  const sec = value % 60;
  if (sec === 0) return `${min}:00`;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatWorkoutDuration(startedAt) {
  const start = new Date(startedAt);
  const diff = Math.max(0, Date.now() - start.getTime());
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function icon(name, label = "") {
  const title = label ? `<title>${escapeHtml(label)}</title>` : "";
  const paths = {
    home: '<path d="M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H4.5A1.5 1.5 0 0 1 3 19.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    history: '<path d="M5 4h14v17H5z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 2v4M16 2v4M5 9h14" stroke="currentColor" stroke-width="2"/>',
    start: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
    profile: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    close: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    save: '<path d="M5 4h12l2 2v14H5z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 4v6h8V4M8 20v-6h8v6" stroke="currentColor" stroke-width="2"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M8 10v9M12 10v9M16 10v9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 7l1 14h10l1-14" fill="none" stroke="currentColor" stroke-width="2"/>',
    calendar: '<rect x="4" y="5" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 10h16M9 3v4M15 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    clock: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    info: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    minimize: '<path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    edit: '<path d="M4 20h4l11-11-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    plates: '<rect x="9" y="4" width="6" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="9" width="3" height="6" rx="1" fill="currentColor"/><rect x="18" y="9" width="3" height="6" rx="1" fill="currentColor"/>',
    star: '<path d="M12 3l2.5 6 6.5.5-5 4.5 1.5 6.5L12 17l-5.5 3.5L8 14 3 9.5l6.5-.5z" fill="currentColor"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2H4.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="2"/>',
    search: '<circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    link: '<path d="M9 15a4 4 0 0 1 0-6l3-3a4 4 0 1 1 5.6 5.6l-1.5 1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 9a4 4 0 0 1 0 6l-3 3a4 4 0 1 1-5.6-5.6l1.5-1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    unlink: '<path d="M9 15a4 4 0 0 1 0-6l3-3a4 4 0 0 1 5 1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 9a4 4 0 0 1 0 6l-3 3a4 4 0 0 1-5-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor"/><circle cx="15" cy="6" r="1.4" fill="currentColor"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/><circle cx="9" cy="18" r="1.4" fill="currentColor"/><circle cx="15" cy="18" r="1.4" fill="currentColor"/>',
    flip: '<path d="M5 8h11l-2-2M5 8l2 2M19 16H8l2-2M19 16l-2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="${label ? "false" : "true"}" role="img">${title}${paths[name] || ""}</svg>`;
}

function exerciseThumb(exercise) {
  if (!exercise) return `<div class="thumb"></div>`;
  if (!exercise.isDefault) return `<div class="thumb custom">C</div>`;
  const color = CATEGORY_COLORS[exercise.category] || "#111111";
  const accent = `${color}33`;
  const drawings = {
    Chest: `<path d="M8 17h8M5 12h14M7 10v4M17 10v4" stroke="${color}" stroke-width="2" stroke-linecap="round"/><path d="M10 7h4l2 5H8z" fill="${accent}" stroke="${color}" stroke-width="1.5"/>`,
    Back: `<path d="M12 5c3 2 5 5 5 11M12 5c-3 2-5 5-5 11" stroke="${color}" stroke-width="2" stroke-linecap="round"/><path d="M8 11h8M9 16h6" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`,
    Legs: `<path d="M10 5v6l-3 7M14 5v6l3 7" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/><path d="M8 18h3M16 18h3" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`,
    Shoulders: `<path d="M6 14c2-5 10-5 12 0" fill="${accent}" stroke="${color}" stroke-width="1.8"/><path d="M9 9h6M12 5v8" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`,
    Arms: `<path d="M8 8c3 0 3 5 0 5M16 8c-3 0-3 5 0 5M8 13h8" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/><circle cx="8" cy="8" r="2" fill="${accent}" stroke="${color}"/>`,
    Core: `<path d="M9 5h6l2 13H7z" fill="${accent}" stroke="${color}" stroke-width="1.7"/><path d="M12 6v12M9 10h6M8 14h8" stroke="${color}" stroke-width="1.4"/>`
  };
  return `<div class="thumb"><svg viewBox="0 0 24 24" role="img" aria-label="${escapeHtml(exercise.name)}">${drawings[exercise.category] || ""}</svg></div>`;
}

function bodyToggleHtml() {
  const v = ui.bodyView === "back" ? "back" : "front";
  return `
    <div class="body-view-toggle segmented" role="tablist" aria-label="Body view">
      <button class="tab-button ${v === "front" ? "active" : ""}" data-body-view="front" role="tab" aria-selected="${v === "front"}" type="button">Front</button>
      <button class="tab-button ${v === "back" ? "active" : ""}" data-body-view="back" role="tab" aria-selected="${v === "back"}" type="button">Back</button>
    </div>
  `;
}

function bodySvg(volumes) {
  return ui.bodyView === "back" ? bodySvgBack(volumes) : bodySvgFront(volumes);
}

function bodySvgFront(volumes) {
  const cls = (category) => `${volumeStatus(category, volumes[category])}${ui.selectedMuscle === category ? " active" : ""}`;
  const aria = (cat) => `aria-label="${escapeHtml(cat)}: ${volumes[cat]}/${getRange(cat).max} sets"`;
  return `
    <div class="body-stage" data-body-view="front">
      <div class="human-body" role="group" aria-label="Muscle map">
      <svg data-muscle="Core" ${aria("Core")} role="button" tabindex="0" class="body-piece body-head" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56.594 95.031"><path class="muscle-zone neutral" d="M15.92 68.5l8.8 12.546 3.97 13.984-9.254-7.38-4.622-15.848zm27.1 0l-8.8 12.546-3.976 13.988 9.254-7.38 4.622-15.848zm6.11-27.775l.108-11.775-21.16-14.742L8.123 26.133 8.09 40.19l-3.24.215 1.462 9.732 5.208 1.81 2.36 11.63 9.72 11.018 10.856-.324 9.56-10.37 1.918-11.952 5.207-1.81 1.342-9.517zm-43.085-1.84l-.257-13.82L28.226 11.9l23.618 15.755-.216 10.37 4.976-17.085L42.556 2.376 25.49 0 10.803 3.673.002 24.415z"/></svg>
      <svg data-muscle="Shoulders" ${aria("Shoulders")} role="button" tabindex="0" class="body-piece body-shoulder" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 109.532 46.594"><path class="muscle-zone ${cls("Shoulders")}" d="M38.244-.004l1.98 9.232-11.653 2.857-7.474-2.637zm33.032 0l-1.98 9.232 11.653 2.857 7.474-2.637zm21.238 10.54l4.044-2.187 12.656 14 .07 5.33S92.76 10.66 92.515 10.535zm-1.285.58c-.008.28 17.762 18.922 17.762 18.922l.537 16.557-6.157-10.55L91.5 30.988 83.148 15.6zm-74.224-.58L12.962 8.35l-12.656 14-.062 5.325s16.52-17.015 16.764-17.14zm1.285.58C18.3 11.396.528 30.038.528 30.038L-.01 46.595l6.157-10.55 11.87-5.056L26.374 15.6z"/></svg>
      <svg data-muscle="Arms" ${aria("Arms")} role="button" tabindex="0" class="body-piece body-arm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 156.344 119.25"><path class="muscle-zone ${cls("Arms")}" d="M21.12 56.5a1.678 1.678 0 0 1-.427.33l.935 8.224 12.977-13.89 1.2-8.958A168.2 168.2 0 0 0 21.12 56.5zm1.387 12.522l-18.07 48.91 5.757 1.333 19.125-39.44 3.518-22.047zm-5.278-18.96l2.638 18.74-17.2 46.023L.01 113.05l6.644-35.518zm118.015 6.44a1.678 1.678 0 0 0 .426.33l-.934 8.222-12.977-13.89-1.2-8.958A168.2 168.2 0 0 1 135.24 56.5zm-1.39 12.52l18.073 48.91-5.758 1.333-19.132-39.44-3.52-22.05zm5.28-18.96l-2.64 18.74 17.2 46.023 2.658-1.775-6.643-35.518zm-103.1-12.323a1.78 1.78 0 0 1 .407-.24l3.666-27.345L33.07.015l-7.258 10.58-6.16 37.04.566 4.973a151.447 151.447 0 0 1 15.808-14.87zm84.3 0a1.824 1.824 0 0 0-.407-.24l-3.666-27.345L123.3.015l7.258 10.58 6.16 37.04-.566 4.973a151.447 151.447 0 0 0-15.822-14.87zM22.288 8.832l-3.3 35.276-2.2-26.238zm111.79 0l3.3 35.276 2.2-26.238z"/></svg>
      <svg data-muscle="Chest" ${aria("Chest")} role="button" tabindex="0" class="body-piece body-chest" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 86.594 45.063"><path class="muscle-zone ${cls("Chest")}" d="M19.32 0l-9.225 16.488-10.1 5.056 6.15 4.836 4.832 14.07 11.2 4.616 17.85-8.828-4.452-34.7zm47.934 0l9.225 16.488 10.1 5.056-6.15 4.836-4.833 14.07-11.2 4.616-17.844-8.828 4.45-34.7z"/></svg>
      <svg data-muscle="Core" ${aria("Core")} role="button" tabindex="0" class="body-piece body-stomach" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75.25 107.594"><path class="muscle-zone ${cls("Core")}" d="M19.25 7.49l16.6-7.5-.5 12.16-14.943 7.662zm-10.322 8.9l6.9 3.848-.8-9.116zm5.617-8.732L1.32 2.15 6.3 15.6zm-8.17 9.267l9.015 5.514 1.54 11.028-8.795-5.735zm15.53 5.89l.332 8.662 12.286-2.665.664-11.826zm14.61 84.783L33.28 76.062l-.08-20.53-11.654-5.736-1.32 37.5zM22.735 35.64L22.57 46.3l11.787 3.166.166-16.657zm-14.16-5.255L16.49 35.9l1.1 11.25-8.8-7.06zm8.79 22.74l-9.673-7.28-.84 9.78L-.006 68.29l10.564 14.594 5.5.883 1.98-20.735zM56 7.488l-16.6-7.5.5 12.16 14.942 7.66zm10.32 8.9l-6.9 3.847.8-9.116zm-5.617-8.733L73.93 2.148l-4.98 13.447zm8.17 9.267l-9.015 5.514-1.54 11.03 8.8-5.736zm-15.53 5.89l-.332 8.662-12.285-2.665-.664-11.827zm-14.61 84.783l3.234-31.536.082-20.532 11.65-5.735 1.32 37.5zm13.78-71.957l.166 10.66-11.786 3.168-.166-16.657zm14.16-5.256l-7.915 5.514-1.1 11.25 8.794-7.06zm-8.79 22.743l9.673-7.28.84 9.78 6.862 12.66-10.564 14.597-5.5.883-1.975-20.74z"/></svg>
      <svg data-muscle="Legs" ${aria("Legs")} role="button" tabindex="0" class="body-piece body-legs" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 93.626 286.625"><path class="muscle-zone ${cls("Legs")}" d="M17.143 138.643l-.664 5.99 4.647 5.77 1.55 9.1 3.1 1.33 2.655-13.755 1.77-4.88-1.55-3.107zm20.582.444l-3.32 9.318-7.082 13.755 1.77 12.647 5.09-14.2 4.205-7.982zm-26.557-12.645l5.09 27.29-3.32-1.777-2.656 8.875zm22.795 42.374l-1.55 4.88-3.32 20.634-.442 27.51 4.65 26.847-.223-34.39 4.87-13.754.663-15.087zM23.34 181.24l1.106 41.267 8.853 33.28-9.628-4.55-16.045-57.8 5.533-36.384zm15.934 80.536l-.664 18.415-1.55 6.435h-4.647l-1.327-4.437-1.55-.222.332 4.437-5.864-1.778-1.55-.887-6.64-1.442-.22-5.214 6.418-10.87 4.426-5.548 10.844-4.437zM13.63 3.076v22.476l15.71 31.073 9.923 30.85L38.23 66.1zm25.49 30.248l.118-.148-.793-2.024L21.9 12.992l-1.242-.44L31.642 40.93zM32.865 44.09l6.812 17.6 2.274-21.596-1.344-3.43zM6.395 61.91l.827 25.34 12.816 35.257-3.928 10.136L3.5 88.133zM30.96 74.69l.345.826 6.47 15.48-4.177 38.342-6.594-3.526 5.715-35.7zm45.5 63.953l.663 5.99-4.647 5.77-1.55 9.1-3.1 1.33-2.655-13.755-1.77-4.88 1.55-3.107zm-20.582.444l3.32 9.318 7.08 13.755-1.77 12.647-5.09-14.2-4.2-7.987zm3.762 29.73l1.55 4.88 3.32 20.633.442 27.51-4.648 26.847.22-34.39-4.867-13.754-.67-15.087zm10.623 12.424l-1.107 41.267-8.852 33.28 9.627-4.55 16.046-57.8-5.533-36.384zM54.33 261.777l.663 18.415 1.546 6.435h4.648l1.328-4.437 1.55-.222-.333 4.437 5.863-1.778 1.55-.887 6.638-1.442.222-5.214-6.418-10.868-4.426-5.547-10.844-4.437zm25.643-258.7v22.476L64.26 56.625l-9.923 30.85L55.37 66.1zM54.48 33.326l-.118-.15.793-2.023L71.7 12.993l1.24-.44L61.96 40.93zm6.255 10.764l-6.812 17.6-2.274-21.595 1.344-3.43zm26.47 17.82l-.827 25.342-12.816 35.256 3.927 10.136 12.61-44.51zM62.64 74.693l-.346.825-6.47 15.48 4.178 38.342 6.594-3.527-5.715-35.7zm19.792 51.75l-5.09 27.29 3.32-1.776 2.655 8.875zM9.495-.007l.827 21.373-7.028 42.308-3.306-34.155zm2.068 27.323L26.24 59.707l3.307 26-6.2 36.58L9.91 85.046l-.827-38.342zM84.103-.01l-.826 21.375 7.03 42.308 3.306-34.155zm-2.066 27.325L67.36 59.707l-3.308 26 6.2 36.58 13.436-37.24.827-38.34z"/></svg>
      <svg data-muscle="Arms" ${aria("Arms")} role="button" tabindex="0" class="body-piece body-hands" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 205 38.938"><path class="muscle-zone ${cls("Arms")}" d="M21.255-.002l2.88 6.9 8.412 1.335.664 12.458-4.427 17.8-2.878-.22 2.8-11.847-2.99-.084-4.676 12.6-3.544-.446 4.4-12.736-3.072-.584-5.978 13.543-4.428-.445 6.088-14.1-2.1-1.25-7.528 12.012-3.764-.445L12.4 12.9l-1.107-1.78L.665 15.57 0 13.124l8.635-7.786zm162.49 0l-2.88 6.9-8.412 1.335-.664 12.458 4.427 17.8 2.878-.22-2.8-11.847 2.99-.084 4.676 12.6 3.544-.446-4.4-12.736 3.072-.584 5.978 13.543 4.428-.445-6.088-14.1 2.1-1.25 7.528 12.012 3.764-.445L192.6 12.9l1.107-1.78 10.628 4.45.665-2.447-8.635-7.786z"/></svg>
      </div>
      <button class="body-back-btn ${cls("Back")}" data-muscle="Back" ${aria("Back")} type="button">Back</button>
    </div>
    ${bodyToggleHtml()}
  `;
}

function bodySvgBack(volumes) {
  const cls = (category) => `${volumeStatus(category, volumes[category])}${ui.selectedMuscle === category ? " active" : ""}`;
  const aria = (cat) => `aria-label="${escapeHtml(cat)}: ${volumes[cat]}/${getRange(cat).max} sets"`;
  return `
    <div class="body-stage" data-body-view="back">
      <div class="human-body human-body--back" role="group" aria-label="Muscle map (back)">
        <svg aria-hidden="true" class="body-piece body-back-head" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 95"><path class="muscle-zone neutral" d="M28 4c-10 0-17 8-17 19 0 9 5 16 11 18l-2 8c-1 3 1 5 4 5h8c3 0 5-2 4-5l-2-8c6-2 11-9 11-18 0-11-7-19-17-19z"/></svg>
        <svg data-muscle="Shoulders" ${aria("Shoulders")} role="button" tabindex="0" class="body-piece body-back-rear-delts" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 46"><path class="muscle-zone ${cls("Shoulders")}" d="M0 28c4-12 14-22 28-26l4 8c-10 4-18 12-22 22zM110 28c-4-12-14-22-28-26l-4 8c10 4 18 12 22 22z"/></svg>
        <svg data-muscle="Back" ${aria("Back")} role="button" tabindex="0" class="body-piece body-traps" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 86 28"><path class="muscle-zone ${cls("Back")}" d="M43 0c-12 0-23 6-30 16l4 8c4-6 12-12 26-14 14 2 22 8 26 14l4-8c-7-10-18-16-30-16z"/></svg>
        <svg data-muscle="Back" ${aria("Back")} role="button" tabindex="0" class="body-piece body-lats" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 86 60"><path class="muscle-zone ${cls("Back")}" d="M2 4c0 18 6 38 18 50 4 4 8 6 12 6h22c4 0 8-2 12-6 12-12 18-32 18-50-6 6-16 12-30 14L43 20l-11-2c-14-2-24-8-30-14z"/></svg>
        <svg data-muscle="Arms" ${aria("Arms")} role="button" tabindex="0" class="body-piece body-triceps" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 156 100"><path class="muscle-zone ${cls("Arms")}" d="M14 8c-4 12-10 32-12 60l8 4 8-26 6-30zM142 8c4 12 10 32 12 60l-8 4-8-26-6-30zM30 4l-2 26 4 36 8 4 6-32-2-30zM126 4l2 26-4 36-8 4-6-32 2-30z"/></svg>
        <svg data-muscle="Core" ${aria("Core")} role="button" tabindex="0" class="body-piece body-lower-back" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40"><path class="muscle-zone ${cls("Core")}" d="M8 4c4 14 14 22 22 22s18-8 22-22c-2 12-6 24-12 32-4 4-12 4-16-2-2-2-4-2-4-2s-2 0-4 2c-4 6-12 6-16 2-6-8-10-20-12-32z"/></svg>
        <svg data-muscle="Legs" ${aria("Legs")} role="button" tabindex="0" class="body-piece body-glutes" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 76 50"><path class="muscle-zone ${cls("Legs")}" d="M2 14c4-8 12-14 22-14 6 0 10 4 12 10l2 14-2 16c-4 6-10 10-18 10-12 0-20-12-20-26 0-4 2-8 4-10zM74 14c-4-8-12-14-22-14-6 0-10 4-12 10l-2 14 2 16c4 6 10 10 18 10 12 0 20-12 20-26 0-4-2-8-4-10z"/></svg>
        <svg data-muscle="Legs" ${aria("Legs")} role="button" tabindex="0" class="body-piece body-hams" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 76 90"><path class="muscle-zone ${cls("Legs")}" d="M6 4c-2 22-4 44 4 70 4 12 8 14 14 14 4 0 8-4 8-12 2-22 0-44-2-72zM70 4c2 22 4 44-4 70-4 12-8 14-14 14-4 0-8-4-8-12-2-22 0-44 2-72z"/></svg>
        <svg data-muscle="Legs" ${aria("Legs")} role="button" tabindex="0" class="body-piece body-calves" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 76 80"><path class="muscle-zone ${cls("Legs")}" d="M8 4c-2 16-4 32 0 50 2 10 6 22 12 24 4 0 8-6 8-16 2-16 0-34-4-58zM68 4c2 16 4 32 0 50-2 10-6 22-12 24-4 0-8-6-8-16-2-16 0-34 4-58z"/></svg>
      </div>
    </div>
    ${bodyToggleHtml()}
  `;
}

function parseRouteFromHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  const parts = raw.split("/");
  const route = parts[0];
  if (!ROUTES.includes(route)) return null;
  return route;
}

function setRoute(route, replace = false) {
  if (!ROUTES.includes(route)) return;
  const target = `#/${route}`;
  if (location.hash === target) {
    if (ui.route !== route) { ui.route = route; render(); }
    return;
  }
  if (replace) location.replace(target);
  else location.hash = target;
}

function render() {
  const isActiveWorkout = ui.route === "start" && Boolean(state.activeWorkout);
  const routeHtml =
    ui.route === "home" ? renderHome()
    : ui.route === "history" ? renderHistory()
    : ui.route === "start" ? renderStartWorkout()
    : renderProfile();
  app.innerHTML = `
    <main class="screen ${isActiveWorkout ? "active-workout-screen" : ""}">
      ${isActiveWorkout ? "" : renderTopbar()}
      ${routeHtml}
    </main>
    ${isActiveWorkout ? "" : renderBottomNav()}
    ${ui.modal ? renderModal() : ""}
    ${renderToast()}
  `;
  if (ui.modal) focusModal();
  ensureLiveHeader();
  attachDragHandlers();
}

function attachDragHandlers() {
  const handles = document.querySelectorAll("[data-drag-handle]");
  handles.forEach((handle) => {
    handle.addEventListener("pointerdown", onDragPointerDown);
  });
}

let dragState = null;
let dragAutoScrollRaf = null;

function onDragPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  if (ui.linking) { actions().cancelLinking(); return; }
  const handle = event.currentTarget;
  const card = handle.closest("[data-exercise-index]");
  if (!card) return;
  const stack = card.parentElement;
  if (!stack) return;
  const kind = handle.dataset.dragKind;
  const fromIndex = Number(handle.dataset.dragIndex);
  const cards = Array.from(stack.querySelectorAll(":scope > [data-exercise-index]"));
  const rects = cards.map((c) => c.getBoundingClientRect());
  const cardRect = card.getBoundingClientRect();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  event.preventDefault();
  try { handle.setPointerCapture(event.pointerId); } catch {}
  document.body.classList.add("dragging");
  card.classList.add("drag-lifted");
  card.style.width = `${cardRect.width}px`;
  card.style.height = `${cardRect.height}px`;
  card.style.position = "fixed";
  card.style.left = `${cardRect.left}px`;
  card.style.top = `${cardRect.top}px`;
  card.style.zIndex = "100";
  card.style.pointerEvents = "none";
  const placeholder = document.createElement("div");
  placeholder.className = "drag-placeholder";
  placeholder.style.height = `${cardRect.height}px`;
  card.parentNode.insertBefore(placeholder, card);
  dragState = {
    kind, fromIndex, cards, rects, card, placeholder, stack,
    pointerId: event.pointerId,
    startY: event.clientY,
    offsetY: event.clientY - cardRect.top,
    currentY: event.clientY,
    toIndex: fromIndex
  };
  handle.addEventListener("pointermove", onDragPointerMove);
  handle.addEventListener("pointerup", onDragPointerUp);
  handle.addEventListener("pointercancel", onDragPointerUp);
  startDragAutoScroll();
}

function onDragPointerMove(event) {
  if (!dragState) return;
  dragState.currentY = event.clientY;
  const newTop = event.clientY - dragState.offsetY;
  dragState.card.style.top = `${newTop}px`;
  const midY = newTop + dragState.card.offsetHeight / 2;
  let toIndex = dragState.fromIndex;
  for (let i = 0; i < dragState.rects.length; i++) {
    const r = dragState.rects[i];
    if (midY > r.top + r.height / 2) toIndex = i;
  }
  if (midY < dragState.rects[0].top + dragState.rects[0].height / 2) toIndex = 0;
  dragState.toIndex = toIndex;
}

function onDragPointerUp(event) {
  if (!dragState) return;
  const { kind, fromIndex, toIndex, card, placeholder } = dragState;
  const handle = event && event.currentTarget;
  if (handle) {
    handle.removeEventListener("pointermove", onDragPointerMove);
    handle.removeEventListener("pointerup", onDragPointerUp);
    handle.removeEventListener("pointercancel", onDragPointerUp);
    try { handle.releasePointerCapture(dragState.pointerId); } catch {}
  }
  card.removeAttribute("style");
  card.classList.remove("drag-lifted");
  if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
  document.body.classList.remove("dragging");
  stopDragAutoScroll();
  const moveTo = toIndex;
  dragState = null;
  if (moveTo !== fromIndex) {
    actions().reorderExercise(kind, fromIndex, moveTo);
  } else {
    render();
  }
}

function startDragAutoScroll() {
  if (dragAutoScrollRaf) return;
  const tick = () => {
    if (!dragState) { dragAutoScrollRaf = null; return; }
    const margin = 70;
    const speed = 10;
    const y = dragState.currentY;
    if (y < margin) window.scrollBy(0, -speed);
    else if (y > window.innerHeight - margin) window.scrollBy(0, speed);
    dragAutoScrollRaf = requestAnimationFrame(tick);
  };
  dragAutoScrollRaf = requestAnimationFrame(tick);
}

function stopDragAutoScroll() {
  if (dragAutoScrollRaf) cancelAnimationFrame(dragAutoScrollRaf);
  dragAutoScrollRaf = null;
}

function renderToast() {
  if (!ui.toast) return "";
  const action = ui.toastAction
    ? `<button class="toast-action" data-toast-action>${escapeHtml(ui.toastAction.label)}</button>`
    : "";
  return `<div class="toast" role="status" aria-live="polite">${escapeHtml(ui.toast)}${action}</div>`;
}

function renderTopbar() {
  return `
    <header class="topbar">
      <button class="brand" data-route="home" aria-label="Home">
        <small>private local PWA</small>
        <strong>Silownia</strong>
      </button>
      <button class="icon-button" data-open-template aria-label="Create template">${icon("plus", "Create template")}</button>
    </header>
  `;
}

function renderBottomNav() {
  const nav = [
    ["home", "Home", "home"],
    ["history", "History", "history"],
    ["start", "Start Workout", "start"],
    ["profile", "Profile", "profile"]
  ];
  return `
    <nav class="bottom-nav" aria-label="Main navigation">
      ${nav.map(([route, label, iconName]) => `
        <button class="nav-item ${ui.route === route ? "active" : ""} ${route === "start" ? "primary" : ""}" data-route="${route}" aria-current="${ui.route === route ? "page" : "false"}">
          ${icon(iconName)}
          <span>${label}</span>
        </button>
      `).join("")}
    </nav>
  `;
}

function renderHome() {
  const volumes = weeklyVolume();
  const selectedSets = volumes[ui.selectedMuscle] || 0;
  const selectedRange = getRange(ui.selectedMuscle);
  const undertrained = CATEGORIES.filter((c) => volumeStatus(c, volumes[c]) === "low");
  const suggestion = undertrained.length > 0
    ? `Najwięcej sensu ma teraz: ${undertrained.slice(0, 3).join(", ")}.`
    : "Tygodniowa objętość wygląda solidnie. Dzisiaj pilnuj jakości serii.";
  return `
    <section class="home-hero">
      <div class="panel body-panel">
        ${bodySvg(volumes)}
        <div class="body-caption">
          <div class="legend">
            <span><i class="dot low"></i>below</span>
            <span><i class="dot mid"></i>optimal</span>
            <span><i class="dot high"></i>high</span>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="section-head">
          <h2>${escapeHtml(ui.selectedMuscle)}</h2>
          <span class="pill">${selectedSets}/${selectedRange.max} sets</span>
        </div>
        <div class="volume-list">
          ${CATEGORIES.map((category) => {
            const sets = volumes[category];
            const range = getRange(category);
            const status = volumeStatus(category, sets);
            return `
              <button class="volume-row" data-muscle="${category}">
                <span class="volume-name"><span>${category}</span><span>${sets}/${range.max}</span></span>
                <span class="progress-track"><span class="progress-fill ${status}" style="width:${volumePercent(category, sets)}%"></span></span>
              </button>
            `;
          }).join("")}
        </div>
        <div class="suggestion">${escapeHtml(suggestion)}</div>
      </div>
    </section>

    ${renderWeeklyRetro(volumes)}

    <section class="section">
      <div class="section-head">
        <h2>My Templates</h2>
        <button class="mini-button" data-open-template>Create</button>
      </div>
      <div class="template-list">
        ${state.templates.length ? state.templates.map(renderTemplateCard).join("") : `<div class="empty-state">No templates yet.</div>`}
      </div>
    </section>
  `;
}

function renderWeeklyRetro(volumes) {
  const totalSets = CATEGORIES.reduce((sum, c) => sum + volumes[c], 0);
  if (totalSets === 0) return "";
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(now); monday.setDate(now.getDate() - day); monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 7);
  const weekSessions = state.sessions.filter((s) => {
    const date = new Date(s.startedAt);
    return date >= monday && date < sunday;
  });
  if (weekSessions.length === 0) return "";
  const totalVolume = weekSessions.reduce((sum, s) => sum + sessionVolume(s), 0);
  let prCount = 0;
  weekSessions.forEach((s) => s.exercises.forEach((we) => we.sets.forEach((set) => {
    if (isPersonalRecord(we.exerciseId, set)) prCount += 1;
  })));
  return `
    <section class="section">
      <div class="panel weekly-retro">
        <div class="section-head">
          <h2>This week</h2>
          <span class="pill">${weekSessions.length} workouts</span>
        </div>
        <div class="retro-grid">
          <div class="retro-cell"><span>Sets</span><strong>${totalSets}</strong></div>
          <div class="retro-cell"><span>Volume</span><strong>${Math.round(totalVolume).toLocaleString("pl-PL")} kg</strong></div>
          <div class="retro-cell"><span>PRs</span><strong>${prCount}</strong></div>
        </div>
      </div>
    </section>
  `;
}

function renderTemplateCard(template) {
  const names = template.exercises.map((item) => getExercise(item.exerciseId)?.name).filter(Boolean);
  const setCount = template.exercises.reduce((sum, item) => sum + Number(item.targetSets || 0), 0);
  return `
    <article class="template-card">
      <div class="template-title-row">
        <div>
          <div class="template-name">${escapeHtml(template.name)}</div>
          <div class="exercise-meta">${escapeHtml(template.notes || `${names.length} exercises`)}</div>
        </div>
        <div class="template-title-actions">
          <span class="pill">${setCount} sets</span>
          <button class="icon-button danger" data-delete-template="${template.id}" aria-label="Delete template" title="Delete template">${icon("trash")}</button>
        </div>
      </div>
      <div class="template-meta">
        ${names.slice(0, 4).map((name) => `<span class="pill">${escapeHtml(name)}</span>`).join("")}
      </div>
      <div class="grid-two">
        <button class="primary-button" data-start-template="${template.id}">Start</button>
        <button class="ghost-button" data-edit-template="${template.id}">Edit</button>
      </div>
    </article>
  `;
}

function renderHistory() {
  return `
    <section class="panel">
      <div class="segmented">
        <button class="tab-button ${ui.historyView === "calendar" ? "active" : ""}" data-history-view="calendar">Calendar</button>
        <button class="tab-button ${ui.historyView === "progress" ? "active" : ""}" data-history-view="progress">Monthly Progress</button>
      </div>
    </section>
    <section class="section">
      ${ui.historyView === "calendar" ? renderCalendar() : renderProgress()}
    </section>
  `;
}

function renderCalendar() {
  const first = new Date(ui.viewedYear, ui.viewedMonth, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(ui.viewedYear, ui.viewedMonth, 1 - startOffset);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
  const sessionsByDate = groupBy(state.sessions, sessionDate);
  const selectedSessions = (sessionsByDate[ui.selectedDate] || []).filter(filterSessionBySearch);
  const filteredAll = state.sessions.filter(filterSessionBySearch);
  return `
    <div class="panel">
      <div class="section-head">
        <button class="mini-button" data-month-shift="-1">Prev</button>
        <h2>${formatMonth(ui.viewedYear, ui.viewedMonth)}</h2>
        <button class="mini-button" data-month-shift="1">Next</button>
      </div>
      <div class="search-row">
        <span class="search-icon">${icon("search")}</span>
        <input data-history-search type="search" placeholder="Search workout, exercise…" value="${escapeHtml(ui.historySearch)}" aria-label="Search history" />
      </div>
      <div class="calendar-grid">
        ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day) => `<div class="weekday">${day}</div>`).join("")}
        ${days.map((date) => {
          const key = toDateKey(date);
          const outside = date.getMonth() !== ui.viewedMonth;
          const dateSessions = (sessionsByDate[key] || []).filter(filterSessionBySearch);
          const hasWorkout = dateSessions.length > 0;
          return `
            <button class="day-cell ${outside ? "outside" : ""} ${hasWorkout ? "has-workout" : ""} ${ui.selectedDate === key ? "selected" : ""}" data-date="${key}">
              ${date.getDate()}
            </button>
          `;
        }).join("")}
      </div>
    </div>
    <div class="workout-detail">
      <div class="section-head">
        <h2>${formatDate(ui.selectedDate)}</h2>
        ${ui.historySearch ? `<span class="pill">${filteredAll.length} match</span>` : ""}
      </div>
      <div class="session-list">
        ${selectedSessions.length ? selectedSessions.map(renderSessionCard).join("") : `<div class="empty-state">No workout recorded.</div>`}
      </div>
      ${ui.historySearch ? renderHistorySearchResults(filteredAll) : ""}
    </div>
  `;
}

function filterSessionBySearch(session) {
  const q = ui.historySearch.trim().toLowerCase();
  if (!q) return true;
  if (session.name.toLowerCase().includes(q)) return true;
  return session.exercises.some((we) => {
    const ex = getExercise(we.exerciseId);
    return ex && ex.name.toLowerCase().includes(q);
  });
}

function renderHistorySearchResults(sessions) {
  if (sessions.length === 0) return "";
  return `
    <div class="section-head"><h3>All matches</h3></div>
    <div class="session-list">
      ${sessions.slice(0, 12).map(renderSessionCard).join("")}
    </div>
  `;
}

function renderSessionCard(session) {
  return `
    <article class="session-card">
      <div class="row-between">
        <div>
          <h3>${escapeHtml(session.name)}</h3>
          <div class="exercise-meta">${formatDate(sessionDate(session))} · ${workoutDurationMinutes(session)} min · ${Math.round(sessionVolume(session)).toLocaleString("pl-PL")} kg</div>
        </div>
        <button class="mini-button" data-view-session="${session.id}">View</button>
      </div>
    </article>
  `;
}

function renderSessionDetails(session) {
  return `
    <div class="modal-head">
      <div>
        <h3 id="modal-title">${escapeHtml(session.name)}</h3>
        <div class="exercise-meta">${formatDate(sessionDate(session))}</div>
      </div>
      <button class="icon-button" data-close-modal aria-label="Close">${icon("close")}</button>
    </div>
    <div class="modal-body">
      ${session.exercises.map((we) => {
        const exercise = getExercise(we.exerciseId);
        return `
          <div class="panel">
            <h3>${escapeHtml(exercise?.name || "Exercise")}</h3>
            ${we.sets.map((set) => {
              const isPr = isPersonalRecord(we.exerciseId, set);
              const reps = set.repsLeft || set.repsRight ? `${set.repsLeft || 0}L / ${set.repsRight || 0}R` : `× ${escapeHtml(set.reps)}`;
              const rir = set.rir != null && set.rir !== "" ? ` · RIR ${set.rir}` : "";
              const note = set.notes ? ` · ${escapeHtml(set.notes)}` : "";
              return `<p class="small">${escapeHtml(set.weight)} kg ${reps}${rir}${note}${isPr ? ` <span class="pr-badge">PR</span>` : ""}</p>`;
            }).join("")}
            ${we.notes ? `<p class="small">${escapeHtml(we.notes)}</p>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderPreviousExerciseModal(exerciseId) {
  const exercise = getExercise(exerciseId);
  const previous = recentExerciseSessions(exerciseId, 6);
  return `
    <div class="modal-head">
      <div>
        <h3 id="modal-title">${escapeHtml(formatExerciseDisplayName(exercise))}</h3>
        <div class="exercise-meta">Previous sessions</div>
      </div>
      <button class="icon-button" data-close-modal aria-label="Close">${icon("close")}</button>
    </div>
    <div class="modal-body">
      ${previous.length ? previous.map(({ session, workoutExercise }) => `
        <article class="previous-session-card">
          <div>
            <strong>${escapeHtml(session.name)}</strong>
            <span>${escapeHtml(formatDate(sessionDate(session)))}</span>
          </div>
          <div class="previous-session-best">${escapeHtml(bestSetLabel(workoutExercise))}</div>
        </article>
      `).join("") : `<div class="empty-state">No previous sessions for this exercise.</div>`}
    </div>
  `;
}

function renderExerciseInfoModal(exerciseId) {
  const exercise = getExercise(exerciseId);
  const info = exerciseInfo(exercise);
  const isCustom = exercise && !exercise.isDefault;
  return `
    <div class="modal-head">
      <div>
        <h3 id="modal-title">${escapeHtml(formatExerciseDisplayName(exercise))}</h3>
        <div class="exercise-meta">${escapeHtml(exercise?.isDefault ? "Default exercise" : "Custom exercise")} · ${escapeHtml(exercise?.category || "")}</div>
      </div>
      <button class="icon-button" data-close-modal aria-label="Close">${icon("close")}</button>
    </div>
    <div class="modal-body">
      <div class="exercise-info-hero">
        ${exerciseThumb(exercise)}
        <div>
          <strong>${escapeHtml(exercise?.category || "Exercise")}</strong>
          <span>${escapeHtml(info.summary)}</span>
        </div>
      </div>
      <div class="exercise-instructions">
        <h3>Instructions</h3>
        ${info.instructions.map((item, index) => `<p><strong>${index + 1}.</strong> ${escapeHtml(item)}</p>`).join("")}
      </div>
      ${isCustom ? `
        <div class="grid-two">
          <button class="ghost-button" data-edit-custom="${exercise.id}">Edit</button>
          <button class="danger-button" data-delete-custom="${exercise.id}">Delete</button>
        </div>` : ""}
    </div>
  `;
}

function renderPlatesModal() {
  const target = Number(ui.modal?.weight ?? 0);
  const result = calculatePlates(target);
  const plates = result.plates.length
    ? result.plates.map((p) => `<li><span class="plate-pill">${p.weight} kg</span><span>× ${p.count} per side</span></li>`).join("")
    : `<li class="muted">Below bar weight (${result.barWeight} kg)</li>`;
  return `
    <div class="modal-head">
      <div>
        <h3 id="modal-title">Plate calculator</h3>
        <div class="exercise-meta">Bar ${result.barWeight} kg · per-side load</div>
      </div>
      <button class="icon-button" data-close-modal aria-label="Close">${icon("close")}</button>
    </div>
    <div class="modal-body">
      <label>Target weight (kg)
        <input type="number" inputmode="decimal" data-plates-input value="${escapeHtml(target)}" min="0" step="0.5" />
      </label>
      <div class="plate-result">
        <div class="plate-result-head">
          <strong>${result.perSide.toFixed(2)} kg per side</strong>
          ${result.leftover > 0 ? `<span class="muted">leftover ${result.leftover} kg</span>` : ""}
        </div>
        <ul class="plate-list">${plates}</ul>
      </div>
    </div>
  `;
}

function renderProgress() {
  const monthSessions = state.sessions.filter((session) => {
    const date = new Date(session.startedAt);
    return date.getMonth() === ui.viewedMonth && date.getFullYear() === ui.viewedYear;
  });
  const exerciseIds = Array.from(new Set(monthSessions.flatMap((session) => session.exercises.map((e) => e.exerciseId))));
  const selectedId = exerciseIds.includes(ui.selectedExerciseId) ? ui.selectedExerciseId : (exerciseIds[0] || ui.selectedExerciseId);
  const selected = getExercise(selectedId);
  const points = progressPoints(selectedId, ui.viewedYear, ui.viewedMonth);
  const stats = progressStats(selectedId, ui.viewedYear, ui.viewedMonth);
  return `
    <div class="panel">
      <div class="section-head">
        <button class="mini-button" data-month-shift="-1">Prev</button>
        <h2>${formatMonth(ui.viewedYear, ui.viewedMonth)}</h2>
        <button class="mini-button" data-month-shift="1">Next</button>
      </div>
      <label>Exercise
        <select data-progress-exercise>
          ${exerciseIds.map((id) => `<option value="${id}" ${id === selectedId ? "selected" : ""}>${escapeHtml(getExercise(id)?.name || id)}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="section">
      <div class="panel chart-wrap">
        <div class="section-head">
          <h2>${escapeHtml(selected?.name || "No exercise")}</h2>
          <span class="pill">estimated 1RM</span>
        </div>
        ${points.length ? renderLineChart(points) : `<div class="empty-state">No data for this month.</div>`}
      </div>
    </div>
    <div class="section stat-grid">
      ${renderStat("Best Weight", `${stats.bestWeight || 0} kg`)}
      ${renderStat("Best Set", stats.bestSet)}
      ${renderStat("Estimated 1RM", `${stats.bestOneRm.toFixed(1)} kg`)}
      ${renderStat("Monthly Volume", `${Math.round(stats.volume).toLocaleString("pl-PL")} kg`)}
      ${renderStat("Sessions", stats.sessions)}
      ${renderStat("Δ Best Weight", stats.comparisonWeight)}
      ${renderStat("Δ 1RM", stats.comparisonOneRm)}
      ${renderStat("Δ Volume", stats.comparisonVolume)}
    </div>
  `;
}

function progressPoints(exerciseId, year, month) {
  return state.sessions
    .filter((session) => {
      const date = new Date(session.startedAt);
      return date.getFullYear() === year && date.getMonth() === month;
    })
    .map((session) => {
      const we = session.exercises.find((e) => e.exerciseId === exerciseId);
      if (!we) return null;
      const best = we.sets.reduce((top, set) => Math.max(top, oneRm(set.weight, set.reps)), 0);
      return { date: sessionDate(session), value: best };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function progressStats(exerciseId, year, month) {
  const current = exerciseStatsForMonth(exerciseId, year, month);
  const prevDate = new Date(year, month - 1, 1);
  const previous = exerciseStatsForMonth(exerciseId, prevDate.getFullYear(), prevDate.getMonth());
  const diff = current.bestOneRm - previous.bestOneRm;
  const weightDiff = current.bestWeight - previous.bestWeight;
  const volumeDiff = current.volume - previous.volume;
  const fmt = (value, unit) => `${value >= 0 ? "+" : ""}${value.toFixed(1)} ${unit}`;
  const fmtVolume = (value) => `${value >= 0 ? "+" : ""}${Math.round(value).toLocaleString("pl-PL")} kg`;
  const noPrev = "no previous data";
  return {
    ...current,
    comparisonOneRm: previous.sessions ? fmt(diff, "kg") : noPrev,
    comparisonWeight: previous.sessions ? fmt(weightDiff, "kg") : noPrev,
    comparisonVolume: previous.sessions ? fmtVolume(volumeDiff) : noPrev
  };
}

function exerciseStatsForMonth(exerciseId, year, month) {
  let bestWeight = 0;
  let bestOneRm = 0;
  let bestSet = "0 x 0";
  let volume = 0;
  let sessions = 0;
  state.sessions.forEach((session) => {
    const date = new Date(session.startedAt);
    if (date.getFullYear() !== year || date.getMonth() !== month) return;
    const we = session.exercises.find((e) => e.exerciseId === exerciseId);
    if (!we) return;
    sessions += 1;
    we.sets.forEach((set) => {
      const weight = Number(set.weight || 0);
      const reps = Number(set.reps || 0);
      volume += weight * reps;
      const calc = oneRm(weight, reps);
      if (weight > bestWeight) bestWeight = weight;
      if (calc > bestOneRm) {
        bestOneRm = calc;
        bestSet = `${weight} x ${reps}`;
      }
    });
  });
  return { bestWeight, bestOneRm, bestSet, volume, sessions };
}

function renderLineChart(points) {
  const width = 320;
  const height = 166;
  const pad = 22;
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(...points.map((p) => p.value));
  const span = Math.max(1, max - min);
  const coords = points.map((p, i) => {
    const x = pad + (i / Math.max(1, points.length - 1)) * (width - pad * 2);
    const y = height - pad - ((p.value - min) / span) * (height - pad * 2);
    return { ...p, x, y };
  });
  const polyline = coords.map((p) => `${p.x},${p.y}`).join(" ");
  return `
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly progress chart">
      <path d="M${pad} ${height - pad}H${width - pad}M${pad} ${pad}V${height - pad}" stroke="#2a2a2a" stroke-width="2" fill="none"/>
      <polyline points="${polyline}" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${coords.map((p) => `
        <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="var(--ink)"/>
        <text x="${p.x}" y="${p.y - 9}" text-anchor="middle" font-size="10" fill="#a8a8a8">${p.value.toFixed(1)}</text>
      `).join("")}
    </svg>
  `;
}

function renderStat(label, value) {
  return `<div class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderStartWorkout() {
  const active = state.activeWorkout;
  if (!active) {
    return `
      <section class="panel">
        <h2>Start Workout</h2>
        <p>Manualny trening od zera. Template'y zostają na Home.</p>
        <button class="primary-button" data-start-empty>Start Empty Workout</button>
      </section>
      <section class="section">
        <div class="empty-state">Dodasz ćwiczenia z katalogu, serie, ciężar, powtórzenia i przerwy między seriami.</div>
      </section>
    `;
  }
  return `
    <header class="workout-bar">
      <button class="icon-button workout-minimize" data-route="home" aria-label="Minimize workout">${icon("minimize", "Minimize workout")}</button>
      <div class="workout-bar-info">
        <span class="workout-bar-label">Active workout</span>
        <span class="workout-bar-timer" data-live-duration>${escapeHtml(formatWorkoutDuration(active.startedAt))}</span>
      </div>
      <div class="workout-bar-actions">
        <button class="icon-button" data-open-plates aria-label="Plate calculator">${icon("plates", "Plates")}</button>
        <button class="workout-finish-button" data-finish-workout>Finish</button>
      </div>
    </header>
    <section class="workout-live">
      <div class="workout-title-block">
        <h1>${escapeHtml(active.name)}</h1>
        <div class="workout-meta-line">
          ${icon("calendar")}
          <span>${escapeHtml(formatDate(sessionDate(active)))}</span>
        </div>
        <div class="workout-meta-line">
          ${icon("clock")}
          <span data-live-duration>${escapeHtml(formatWorkoutDuration(active.startedAt))}</span>
        </div>
        <input class="workout-note-input" data-active-workout-note value="${escapeHtml(active.notes || "")}" placeholder="Notes" aria-label="Workout notes" />
      </div>

      ${renderLinkingBanner("workout")}
      <div class="workout-exercise-stack" data-stack-kind="workout">
        ${active.exercises.length ? active.exercises.map((we, i) => renderWorkoutExercise(we, i)).join("") : `<div class="empty-state">No exercises yet. Add one below.</div>`}
      </div>

      <button class="workout-add-exercise" data-open-catalog="workout">+ Add Exercise</button>
      <button class="workout-cancel-button" data-cancel-workout>Cancel Workout</button>
    </section>
  `;
}

function renderLinkingBanner(kind) {
  if (!ui.linking || ui.linking.kind !== kind) return "";
  return `
    <div class="link-banner" role="status">
      <span>Wybierz drugie ćwiczenie do supersetu</span>
      <button class="ghost-button" type="button" data-cancel-link>Anuluj</button>
    </div>
  `;
}

function groupBadge(list, index) {
  const item = list[index];
  if (!item || !item.groupId) return "";
  const order = list.filter((it) => it.groupId === item.groupId).indexOf(item);
  const letter = String.fromCharCode(65 + order);
  return `<span class="group-badge" aria-label="Superset ${letter}">${letter}</span>`;
}

function groupClasses(list, index) {
  const item = list[index];
  if (!item || !item.groupId) return "";
  const peers = list.map((it, i) => ({ it, i })).filter(({ it }) => it.groupId === item.groupId);
  const first = peers[0].i === index;
  const last = peers[peers.length - 1].i === index;
  return `grouped${first ? " group-first" : ""}${last ? " group-last" : ""}${first && last ? " group-only" : ""}`;
}

function linkingClasses(kind, index) {
  if (!ui.linking || ui.linking.kind !== kind) return "";
  if (ui.linking.sourceIndex === index) return "linking-source";
  return "linking-target";
}

function renderWorkoutExercise(workoutExercise, index) {
  const exercise = getExercise(workoutExercise.exerciseId);
  const exerciseName = formatExerciseDisplayName(exercise);
  const sugg = suggestNextSet(workoutExercise.exerciseId);
  const list = state.activeWorkout?.exercises || [];
  const linkCls = linkingClasses("workout", index);
  const grpCls = groupClasses(list, index);
  const overlay = linkCls === "linking-target"
    ? `<button class="linking-overlay" type="button" data-link-target="${index}" aria-label="Połącz w superset">Połącz tu</button>`
    : "";
  return `
    <article class="workout-exercise ${grpCls} ${linkCls}" data-workout-exercise="${workoutExercise.id}" data-exercise-index="${index}">
      ${overlay}
      <div class="workout-exercise-head">
        <button class="drag-handle" type="button" data-drag-handle data-drag-kind="workout" data-drag-index="${index}" aria-label="Reorder exercise">${icon("grip")}</button>
        ${groupBadge(list, index)}
        <h2>${escapeHtml(exerciseName)}${workoutExercise.unilateral ? ` <span class="pill">L|R</span>` : ""}</h2>
        <div class="exercise-actions">
          <button class="exercise-tool-button" data-toggle-unilateral="${workoutExercise.id}" aria-label="Toggle per-side reps" title="Per-side reps">L|R</button>
          <button class="exercise-tool-button" data-open-previous="${workoutExercise.exerciseId}" aria-label="Previous sessions">${icon("history")}</button>
          <button class="exercise-tool-button" data-open-exercise-info="${workoutExercise.exerciseId}" aria-label="Exercise info">${icon("info")}</button>
          ${workoutExercise.groupId
            ? `<button class="exercise-tool-button" data-ungroup="workout:${workoutExercise.groupId}" aria-label="Ungroup superset" title="Ungroup">${icon("unlink")}</button>`
            : `<button class="exercise-tool-button" data-start-link="workout:${index}" aria-label="Group with…" title="Group with…">${icon("link")}</button>`}
          <button class="exercise-tool-button danger" data-remove-workout-exercise="${workoutExercise.id}" aria-label="Remove exercise">${icon("trash")}</button>
        </div>
      </div>
      ${sugg ? `<div class="suggestion small">Last: ${sugg.last.weight} kg × ${sugg.last.reps}. Try ${sugg.weightPlus} kg × ${sugg.repsSame} or ${sugg.weightSame} kg × ${sugg.repsPlus}.</div>` : ""}
      <div class="workout-set-table ${workoutExercise.unilateral ? "unilateral" : ""}">
        <div class="workout-set-header">
          <span>Set</span>
          <span>Previous</span>
          <span>kg</span>
          <span>${workoutExercise.unilateral ? "L / R" : "Reps"}</span>
          <span aria-label="Done">✓</span>
        </div>
        ${workoutExercise.sets.map((set, index) => renderSetRow(workoutExercise, set, index)).join("")}
      </div>
      <button class="workout-add-set" data-add-set="${workoutExercise.id}">+ Add Set</button>
      <textarea class="workout-exercise-note" data-exercise-note="${workoutExercise.id}" placeholder="Exercise notes (RPE, soreness, …)" aria-label="Exercise notes">${escapeHtml(workoutExercise.notes || "")}</textarea>
      ${renderExerciseRestFooter(workoutExercise)}
    </article>
  `;
}

function renderSetRow(workoutExercise, set, index) {
  const isPr = set.completed && isPersonalRecord(workoutExercise.exerciseId, set);
  const expandedKey = `${workoutExercise.id}:${set.id}`;
  const expanded = ui.expandedSet === expandedKey;
  const repsCell = workoutExercise.unilateral
    ? `
      <div class="reps-pair">
        <input class="workout-set-input" inputmode="numeric" data-set-input="${workoutExercise.id}:${set.id}:repsLeft" value="${escapeHtml(set.repsLeft)}" aria-label="Reps left" placeholder="L" />
        <input class="workout-set-input" inputmode="numeric" data-set-input="${workoutExercise.id}:${set.id}:repsRight" value="${escapeHtml(set.repsRight)}" aria-label="Reps right" placeholder="R" />
      </div>
    `
    : `<input class="workout-set-input" inputmode="numeric" data-set-input="${workoutExercise.id}:${set.id}:reps" value="${escapeHtml(set.reps)}" aria-label="Reps" />`;
  return `
    <div class="workout-set-row ${set.completed ? "completed" : ""}">
      <button class="set-index-pill" data-toggle-set-expand="${expandedKey}" aria-label="Set ${set.setNumber} options">${set.setNumber}${isPr ? ` <span class="pr-dot" aria-label="PR"></span>` : ""}</button>
      <span class="previous-set">${escapeHtml(previousSetLabel(workoutExercise.exerciseId, index))}</span>
      <input class="workout-set-input" inputmode="decimal" data-set-input="${workoutExercise.id}:${set.id}:weight" value="${escapeHtml(set.weight)}" aria-label="Weight kg" />
      ${repsCell}
      <button class="set-check ${set.completed ? "active" : ""}" data-toggle-set="${workoutExercise.id}:${set.id}" aria-label="${set.completed ? "Mark set undone" : "Mark set done"}" aria-pressed="${set.completed ? "true" : "false"}">✓</button>
    </div>
    ${expanded ? `
      <div class="set-extra">
        <label>RIR<input type="number" inputmode="numeric" min="0" max="10" data-set-input="${workoutExercise.id}:${set.id}:rir" value="${escapeHtml(set.rir ?? "")}" placeholder="–" /></label>
        <label class="set-extra-notes">Note<input data-set-input="${workoutExercise.id}:${set.id}:notes" value="${escapeHtml(set.notes || "")}" placeholder="optional" /></label>
        <button class="ghost-button danger-link" data-remove-set="${workoutExercise.id}:${set.id}">Remove set</button>
      </div>
    ` : ""}
  `;
}

function renderExerciseRestFooter(workoutExercise) {
  const activeSeconds = timerFor(workoutExercise.id);
  const seconds = activeSeconds || workoutExercise.restSeconds;
  const isRunning = activeSeconds > 0;
  const presets = [60, 90, 120, 180];
  return `
    <button class="exercise-rest-footer ${isRunning ? "running" : ""}" data-start-rest="${workoutExercise.id}" data-rest-footer="${workoutExercise.id}" aria-label="Start rest timer">
      <span></span>
      <strong>${formatRestShort(seconds)}</strong>
      <span></span>
    </button>
    <div class="exercise-rest-controls">
      <button type="button" class="rest-chip" data-adjust-rest="${workoutExercise.id}:-15" aria-label="Skróć przerwę o 15s">-15s</button>
      ${presets.map((s) => `<button type="button" class="rest-chip ${Number(workoutExercise.restSeconds) === s ? "active" : ""}" data-preset-rest="${workoutExercise.id}:${s}">${formatRestShort(s)}</button>`).join("")}
      <button type="button" class="rest-chip" data-adjust-rest="${workoutExercise.id}:15" aria-label="Wydłuż przerwę o 15s">+15s</button>
    </div>
  `;
}

function renderProfile() {
  const totalSessions = state.sessions.length;
  const totalVolume = state.sessions.reduce((sum, s) => sum + sessionVolume(s), 0);
  const isAuthenticated = currentIdentity !== "local";
  return `
    ${isAuthenticated ? `
    <section class="profile-card account-card">
      <div class="section-head">
        <h2>Konto</h2>
      </div>
      <div class="account-row">
        <div class="account-info">
          <span class="muted">Zalogowany jako</span>
          <strong>${escapeHtml(currentIdentity)}</strong>
        </div>
        <a class="ghost-button" href="/cdn-cgi/access/logout" data-logout>Wyloguj</a>
      </div>
    </section>
    ` : ""}
    <section class="profile-card">
      <h2>Profile</h2>
      <div class="form-grid">
        <label>Name<input data-profile="name" value="${escapeHtml(state.profile.name)}" /></label>
        <label>Goal<input data-profile="goal" value="${escapeHtml(state.profile.goal)}" /></label>
        <label>Body weight<input data-profile="bodyWeight" inputmode="decimal" value="${escapeHtml(state.profile.bodyWeight)}" /></label>
        <label>Bar weight (kg)<input data-profile="barWeight" inputmode="decimal" value="${escapeHtml(state.profile.barWeight)}" /></label>
      </div>
    </section>
    <section class="section stat-grid">
      ${renderStat("Workouts", totalSessions)}
      ${renderStat("Total Volume", `${Math.round(totalVolume).toLocaleString("pl-PL")} kg`)}
    </section>
    <section class="section profile-card">
      <div class="section-head">
        <h2>Notifications</h2>
      </div>
      <div class="row-between">
        <span class="muted">Push when rest timer ends</span>
        <button class="ghost-button" data-toggle-notifications>${state.profile.notifications ? "Enabled" : "Enable"}</button>
      </div>
    </section>
    <section class="section profile-card">
      <div class="section-head">
        <h2>Weekly set ranges</h2>
      </div>
      <div class="form-grid">
        ${CATEGORIES.map((category) => {
          const range = getRange(category);
          return `
            <div class="template-builder-row">
              <label>${category}<input value="${category}" disabled /></label>
              <label>Min<input inputmode="numeric" data-range="${category}:min" value="${range.min}" /></label>
              <label>Max<input inputmode="numeric" data-range="${category}:max" value="${range.max}" /></label>
            </div>
          `;
        }).join("")}
      </div>
    </section>
    <section class="section profile-card">
      <h2>Local data</h2>
      <p>Dane są zapisane lokalnie w tej przeglądarce. Brak chmury, trackingu i zdalnego repozytorium.</p>
      <div class="data-actions">
        <button class="ghost-button" data-export-file>Download backup</button>
        <button class="ghost-button" data-import-file>Restore backup</button>
      </div>
      <div class="data-actions">
        <button class="ghost-button" data-export>View JSON</button>
        <button class="danger-button" data-reset-demo>Reset Demo</button>
      </div>
    </section>
  `;
}

function renderModal() {
  return `<div class="modal-backdrop" data-backdrop><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">${modalContent()}</div></div>`;
}

function modalContent() {
  if (ui.modal.type === "catalog") return renderCatalogModal();
  if (ui.modal.type === "customExercise") return renderCustomExerciseModal();
  if (ui.modal.type === "template") return renderTemplateModal();
  if (ui.modal.type === "session") return renderSessionDetails(ui.modal.session);
  if (ui.modal.type === "previousExercise") return renderPreviousExerciseModal(ui.modal.exerciseId);
  if (ui.modal.type === "exerciseInfo") return renderExerciseInfoModal(ui.modal.exerciseId);
  if (ui.modal.type === "export") return renderExportModal();
  if (ui.modal.type === "plates") return renderPlatesModal();
  if (ui.modal.type === "confirm") return renderConfirmModal();
  return "";
}

function renderConfirmModal() {
  const m = ui.modal;
  return `
    <div class="modal-head">
      <h3 id="modal-title">${escapeHtml(m.title || "Confirm")}</h3>
      <button class="icon-button" data-close-modal aria-label="Close">${icon("close")}</button>
    </div>
    <div class="modal-body">
      <p>${escapeHtml(m.message || "Are you sure?")}</p>
      <div class="grid-two">
        <button class="ghost-button" data-close-modal>Cancel</button>
        <button class="danger-button" data-confirm-action>${escapeHtml(m.confirmLabel || "Confirm")}</button>
      </div>
    </div>
  `;
}

function renderCatalogModal() {
  const { defaults, customs } = exercisesByCategory(ui.catalogCategory, ui.catalogSearch);
  return `
    <div class="modal-head">
      <div>
        <h3 id="modal-title">Exercise Catalog</h3>
        <div class="exercise-meta">Default A-Z, custom at bottom</div>
      </div>
      <button class="icon-button" data-close-modal aria-label="Close">${icon("close")}</button>
    </div>
    <div class="modal-body">
      <div class="chip-row">
        ${CATEGORIES.map((category) => `<button class="chip ${ui.catalogCategory === category ? "active" : ""}" data-catalog-category="${category}">${category}</button>`).join("")}
      </div>
      <input data-catalog-search placeholder="Search exercise" value="${escapeHtml(ui.catalogSearch)}" aria-label="Search exercise" />
      <button class="ghost-button" data-open-custom>Add Custom Exercise</button>
      <div class="divider-label">Default Exercises</div>
      <div class="exercise-list">
        ${defaults.map(renderExerciseRow).join("") || `<div class="empty-state">No default exercises.</div>`}
      </div>
      <div class="divider-label">Custom Exercises</div>
      <div class="exercise-list">
        ${customs.map(renderExerciseRow).join("") || `<div class="empty-state">No custom exercises in this category.</div>`}
      </div>
    </div>
  `;
}

function renderExerciseRow(exercise) {
  return `
    <button class="exercise-row" data-select-exercise="${exercise.id}">
      ${exerciseThumb(exercise)}
      <span>
        <span class="exercise-name">${escapeHtml(exercise.name)}</span>
        <span class="exercise-meta">${exercise.isDefault ? "Default" : "Custom"} · ${escapeHtml(exercise.category)}</span>
      </span>
      ${exercise.isDefault ? "" : `<span class="pill">Custom</span>`}
    </button>
  `;
}

function renderCustomExerciseModal() {
  const editing = ui.modal.exercise || null;
  return `
    <div class="modal-head">
      <h3 id="modal-title">${editing ? "Edit Custom Exercise" : "Add Custom Exercise"}</h3>
      <button class="icon-button" data-close-modal aria-label="Close">${icon("close")}</button>
    </div>
    <form class="modal-body" data-custom-form ${editing ? `data-editing-id="${editing.id}"` : ""}>
      <label>Exercise Name<input name="name" required placeholder="Incline Smith Press" value="${escapeHtml(editing?.name || "")}" /></label>
      <label>
        Category
        <select name="category">
          ${CATEGORIES.map((category) => {
            const sel = (editing ? editing.category : ui.catalogCategory) === category ? "selected" : "";
            return `<option ${sel}>${category}</option>`;
          }).join("")}
        </select>
      </label>
      <label>Notes<textarea name="notes" placeholder="Optional">${escapeHtml(editing?.notes || "")}</textarea></label>
      <button class="primary-button" type="submit">${editing ? "Save Exercise" : "Add Exercise"}</button>
    </form>
  `;
}

function renderTemplateModal() {
  const template = ui.modal.template;
  return `
    <div class="modal-head">
      <div>
        <h3 id="modal-title">${template.id ? "Edit Template" : "Create Template"}</h3>
        <div class="exercise-meta">Templates start from Home</div>
      </div>
      <button class="icon-button" data-close-modal aria-label="Close">${icon("close")}</button>
    </div>
    <form class="modal-body" data-template-form>
      <label>Name<input name="name" data-template-name required value="${escapeHtml(template.name)}" /></label>
      <label>Notes<textarea name="notes" data-template-notes>${escapeHtml(template.notes || "")}</textarea></label>
      <div class="section-head">
        <h3>Exercises</h3>
        <button class="mini-button" type="button" data-open-catalog="template">Add</button>
      </div>
      ${renderLinkingBanner("template")}
      <div class="form-grid" data-stack-kind="template">
        ${template.exercises.length ? template.exercises.map((item, index) => {
          const exercise = getExercise(item.exerciseId);
          const linkCls = linkingClasses("template", index);
          const grpCls = groupClasses(template.exercises, index);
          const overlay = linkCls === "linking-target"
            ? `<button class="linking-overlay" type="button" data-link-target="${index}" aria-label="Połącz w superset">Połącz tu</button>`
            : "";
          return `
            <div class="panel template-exercise ${grpCls} ${linkCls}" data-exercise-index="${index}">
              ${overlay}
              <div class="row-between">
                <div class="template-exercise-head">
                  <button class="drag-handle" type="button" data-drag-handle data-drag-kind="template" data-drag-index="${index}" aria-label="Reorder exercise">${icon("grip")}</button>
                  ${groupBadge(template.exercises, index)}
                  <h3>${escapeHtml(exercise?.name || "Exercise")}</h3>
                </div>
                <div class="exercise-actions">
                  ${item.groupId
                    ? `<button class="icon-button" type="button" data-ungroup="template:${item.groupId}" aria-label="Ungroup superset">${icon("unlink")}</button>`
                    : `<button class="icon-button" type="button" data-start-link="template:${index}" aria-label="Group with…">${icon("link")}</button>`}
                  <button class="icon-button danger" type="button" data-remove-template-exercise="${index}" aria-label="Remove">${icon("trash")}</button>
                </div>
              </div>
              <div class="template-builder-row template-builder-row--quad">
                <label>Sets<input inputmode="numeric" data-template-field="${index}:targetSets" value="${item.targetSets}" /></label>
                <label>Reps min<input inputmode="numeric" data-template-field="${index}:repsMin" value="${item.repsMin}" /></label>
                <label>Reps max<input inputmode="numeric" data-template-field="${index}:repsMax" value="${item.repsMax}" /></label>
                <label>Rest sec<input inputmode="numeric" data-template-field="${index}:restSeconds" value="${item.restSeconds}" /></label>
              </div>
            </div>
          `;
        }).join("") : `<div class="empty-state">No exercises in template.</div>`}
      </div>
      <button class="primary-button" type="submit">${template.id ? "Save Template" : "Create Template"}</button>
    </form>
  `;
}

function renderExportModal() {
  return `
    <div class="modal-head">
      <h3 id="modal-title">Export JSON</h3>
      <button class="icon-button" data-close-modal aria-label="Close">${icon("close")}</button>
    </div>
    <div class="modal-body">
      <textarea readonly aria-label="Export JSON">${escapeHtml(JSON.stringify({ schema: SCHEMA_VERSION, data: state }, null, 2))}</textarea>
    </div>
  `;
}

function groupBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});
}

function showToast(message, action = null) {
  ui.toast = message;
  ui.toastAction = action;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    ui.toast = "";
    ui.toastAction = null;
    render();
  }, action ? UNDO_DURATION_MS : TOAST_DURATION_MS);
}

function pushUndoSnapshot() {
  undoSnapshot = JSON.parse(JSON.stringify({ state, ui: { selectedDate: ui.selectedDate } }));
  if (undoTimeout) clearTimeout(undoTimeout);
  undoTimeout = setTimeout(() => { undoSnapshot = null; }, UNDO_DURATION_MS);
}

function performUndo() {
  if (!undoSnapshot) return;
  state = undoSnapshot.state;
  Object.assign(ui, undoSnapshot.ui);
  undoSnapshot = null;
  invalidateExerciseCache();
  invalidateVolumeCache();
  saveStateNow();
  showToast("Reverted");
  render();
}

function ensureLiveHeader() {
  const isActive = ui.route === "start" && state.activeWorkout;
  if (isActive && !liveHeaderInterval) {
    liveHeaderInterval = setInterval(updateLiveHeader, 1000);
  } else if (!isActive && liveHeaderInterval) {
    clearInterval(liveHeaderInterval);
    liveHeaderInterval = null;
  }
}

function updateLiveHeader() {
  if (!state.activeWorkout) return;
  const formatted = formatWorkoutDuration(state.activeWorkout.startedAt);
  document.querySelectorAll("[data-live-duration]").forEach((el) => {
    if (el.textContent !== formatted) el.textContent = formatted;
  });
}

function updateRestFooterDom(workoutExerciseId) {
  const seconds = ui.restTimer && ui.restTimer.workoutExerciseId === workoutExerciseId
    ? Math.max(0, ui.restTimer.remaining)
    : 0;
  const footer = document.querySelector(`[data-rest-footer="${workoutExerciseId}"]`);
  if (!footer) return;
  const isRunning = seconds > 0;
  footer.classList.toggle("running", isRunning);
  const display = isRunning ? seconds : (findWorkoutExercise(workoutExerciseId)?.restSeconds || 0);
  const strong = footer.querySelector("strong");
  if (strong) strong.textContent = formatRestShort(display);
}

function focusModal() {
  const modal = document.querySelector(".modal");
  if (!modal) return;
  const focusable = modal.querySelector("input, select, textarea, button");
  if (focusable) {
    requestAnimationFrame(() => focusable.focus({ preventScroll: true }));
  } else {
    modal.focus({ preventScroll: true });
  }
}

function trapFocusInModal(event) {
  if (!ui.modal || event.key !== "Tab") return;
  const modal = document.querySelector(".modal");
  if (!modal) return;
  const focusables = modal.querySelectorAll('input, select, textarea, button:not([disabled]), [tabindex="0"]');
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function findWorkoutExercise(workoutExerciseId) {
  return state.activeWorkout?.exercises.find((e) => e.id === workoutExerciseId) || null;
}

function findSet(workoutExerciseId, setId) {
  return findWorkoutExercise(workoutExerciseId)?.sets.find((s) => s.id === setId) || null;
}

function actions() {
  return {
    navigate(route) {
      if (ui.linking) ui.linking = null;
      setRoute(route);
    },
    selectMuscle(muscle) {
      if (muscle === ui.selectedMuscle) return;
      ui.selectedMuscle = muscle;
      render();
    },
    historyView(view) {
      ui.historyView = view;
      render();
    },
    historySearch(value) {
      ui.historySearch = value;
      render();
    },
    monthShift(delta) {
      const date = new Date(ui.viewedYear, ui.viewedMonth + delta, 1);
      ui.viewedYear = date.getFullYear();
      ui.viewedMonth = date.getMonth();
      ui.selectedDate = toDateKey(date);
      render();
    },
    selectDate(date) {
      ui.selectedDate = date;
      render();
    },
    viewSession(id) {
      const session = state.sessions.find((s) => s.id === id);
      if (session) openModal({ type: "session", session });
    },
    selectProgressExercise(id) {
      ui.selectedExerciseId = id;
      render();
    },
    openTemplate(template = null) {
      const draft = template ? structuredClone(template) : { id: null, name: "", notes: "", exercises: [] };
      openModal({ type: "template", template: draft });
    },
    openCatalog(target) {
      const next = target === "template" && ui.modal?.type === "template"
        ? { type: "catalog", target, template: ui.modal.template }
        : { type: "catalog", target };
      openModal(next);
    },
    openCustomExercise(exercise = null) {
      openModal({ type: "customExercise", returnTo: ui.modal, exercise });
    },
    openPrevious(exerciseId) {
      openModal({ type: "previousExercise", exerciseId });
    },
    openExerciseInfo(exerciseId) {
      openModal({ type: "exerciseInfo", exerciseId });
    },
    openPlates() {
      let initial = 0;
      const active = state.activeWorkout;
      if (active && active.exercises.length) {
        outer:
        for (let i = active.exercises.length - 1; i >= 0; i--) {
          const sets = active.exercises[i].sets;
          for (let j = sets.length - 1; j >= 0; j--) {
            const w = Number(sets[j].weight);
            if (Number.isFinite(w) && w > 0) { initial = w; break outer; }
          }
        }
      }
      openModal({ type: "plates", weight: initial });
    },
    catalogCategory(category) {
      ui.catalogCategory = category;
      ui.catalogSearch = "";
      render();
    },
    catalogSearch(value) {
      ui.catalogSearch = value;
      render();
    },
    selectExerciseFromCatalog(exerciseId) {
      const target = ui.modal?.target;
      if (target === "workout") {
        if (!state.activeWorkout) startEmptyWorkout(false);
        state.activeWorkout.exercises.push({
          id: uid("wex"),
          exerciseId,
          restSeconds: DEFAULT_REST_WORKOUT,
          unilateral: false,
          groupId: null,
          notes: "",
          sets: [{ id: uid("set"), setNumber: 1, weight: "", reps: "", repsLeft: "", repsRight: "", completed: false, rir: null, notes: "" }]
        });
        invalidateVolumeCache();
        ui.modal = null;
        ui.route = "start";
        if (location.hash !== "#/start") location.replace("#/start");
        showToast("Exercise added");
        queueSave();
        render();
      } else if (target === "template" && ui.modal?.template) {
        const template = ui.modal.template;
        template.exercises.push({ exerciseId, targetSets: 3, repsMin: 8, repsMax: 12, restSeconds: DEFAULT_REST_TEMPLATE, groupId: null });
        ui.modal = { type: "template", template };
        showToast("Exercise added");
        render();
      }
    },
    addCustomExercise(formData) {
      const name = String(formData.get("name") || "").trim();
      const category = String(formData.get("category") || "");
      const notes = String(formData.get("notes") || "");
      if (!name) return;
      const editing = ui.modal?.exercise;
      if (editing) {
        const idx = state.customExercises.findIndex((e) => e.id === editing.id);
        if (idx >= 0) state.customExercises[idx] = { ...editing, name, category, notes };
        showToast("Exercise updated");
      } else {
        state.customExercises.push({
          id: `custom-${slug(name)}-${Date.now().toString(36)}`,
          name,
          category,
          notes,
          isDefault: false,
          createdAt: toLocalDateTime(new Date())
        });
        showToast("Custom exercise added");
      }
      invalidateExerciseCache();
      ui.catalogCategory = category;
      ui.modal = ui.modal?.returnTo || { type: "catalog", target: "workout" };
      queueSave();
      render();
    },
    editCustomExercise(id) {
      const exercise = state.customExercises.find((e) => e.id === id);
      if (!exercise) return;
      openModal({ type: "customExercise", exercise, returnTo: { type: "catalog", target: "workout" } });
    },
    deleteCustomExercise(id) {
      const exercise = state.customExercises.find((e) => e.id === id);
      if (!exercise) return;
      openModal({
        type: "confirm",
        title: "Delete custom exercise",
        message: `Remove "${exercise.name}" from your catalog? Past sessions keep the data.`,
        confirmLabel: "Delete",
        onConfirm: () => {
          pushUndoSnapshot();
          state.customExercises = state.customExercises.filter((e) => e.id !== id);
          invalidateExerciseCache();
          queueSave();
          ui.modal = null;
          showToast("Exercise deleted", { label: "Undo", run: performUndo });
          render();
        }
      });
    },
    saveTemplate(formData) {
      if (!ui.modal?.template) return;
      const template = {
        ...ui.modal.template,
        name: String(formData.get("name") || "").trim(),
        notes: String(formData.get("notes") || "").trim()
      };
      if (!template.name) return;
      if (template.id) {
        state.templates = state.templates.map((t) => (t.id === template.id ? template : t));
      } else {
        template.id = uid("tpl");
        state.templates.push(template);
      }
      ui.modal = null;
      showToast("Template saved");
      queueSave();
      render();
    },
    updateTemplateField(index, key, value) {
      if (!ui.modal?.template) return;
      ui.modal.template.exercises[Number(index)][key] = Number(value || 0);
      render();
    },
    removeTemplateExercise(index) {
      if (!ui.modal?.template) return;
      ui.modal.template.exercises.splice(Number(index), 1);
      cleanupSoloGroups(ui.modal.template.exercises);
      render();
    },
    startEmpty() {
      startEmptyWorkout();
    },
    startTemplate(id) {
      const template = state.templates.find((t) => t.id === id);
      if (!template) return;
      state.activeWorkout = {
        id: uid("active"),
        name: template.name,
        templateId: id,
        startedAt: toLocalDateTime(new Date()),
        notes: template.notes || "",
        exercises: template.exercises.map((item) => ({
          id: uid("wex"),
          exerciseId: item.exerciseId,
          restSeconds: item.restSeconds || DEFAULT_REST_TEMPLATE,
          unilateral: false,
          groupId: item.groupId || null,
          notes: "",
          sets: Array.from({ length: Number(item.targetSets || 1) }, (_, index) => ({
            id: uid("set"),
            setNumber: index + 1,
            weight: "",
            reps: "",
            repsLeft: "",
            repsRight: "",
            completed: false,
            rir: null,
            notes: ""
          }))
        }))
      };
      invalidateVolumeCache();
      setRoute("start");
      showToast("Template workout started");
      queueSave();
      render();
    },
    addSet(workoutExerciseId) {
      const we = findWorkoutExercise(workoutExerciseId);
      if (!we) return;
      we.sets.push({
        id: uid("set"),
        setNumber: we.sets.length + 1,
        weight: "",
        reps: "",
        repsLeft: "",
        repsRight: "",
        completed: false,
        rir: null,
        notes: ""
      });
      queueSave();
      render();
    },
    removeSet(workoutExerciseId, setId) {
      const we = findWorkoutExercise(workoutExerciseId);
      if (!we) return;
      pushUndoSnapshot();
      we.sets = we.sets.filter((s) => s.id !== setId);
      we.sets.forEach((s, i) => { s.setNumber = i + 1; });
      ui.expandedSet = null;
      invalidateVolumeCache();
      queueSave();
      showToast("Set removed", { label: "Undo", run: performUndo });
      render();
    },
    updateSetField(workoutExerciseId, setId, field, value) {
      const set = findSet(workoutExerciseId, setId);
      if (!set) return;
      if (field === "rir") set[field] = value === "" ? null : Number(value);
      else set[field] = value;
      queueSave();
    },
    toggleSet(workoutExerciseId, setId) {
      const set = findSet(workoutExerciseId, setId);
      const we = findWorkoutExercise(workoutExerciseId);
      if (!set || !we) return;
      set.completed = !set.completed;
      invalidateVolumeCache();
      queueSave();
      if (set.completed && isPersonalRecord(we.exerciseId, set)) showToast("New PR");
      render();
      if (set.completed) startRest(workoutExerciseId);
    },
    toggleSetExpand(key) {
      ui.expandedSet = ui.expandedSet === key ? null : key;
      render();
    },
    toggleUnilateral(workoutExerciseId) {
      const we = findWorkoutExercise(workoutExerciseId);
      if (!we) return;
      we.unilateral = !we.unilateral;
      queueSave();
      render();
    },
    updateExerciseNote(workoutExerciseId, value) {
      const we = findWorkoutExercise(workoutExerciseId);
      if (!we) return;
      we.notes = value;
      queueSave();
    },
    removeWorkoutExercise(workoutExerciseId) {
      const we = findWorkoutExercise(workoutExerciseId);
      if (!we || !state.activeWorkout) return;
      const hasCompleted = we.sets.some((s) => s.completed);
      if (hasCompleted) {
        const exercise = getExercise(we.exerciseId);
        openModal({
          type: "confirm",
          title: "Remove exercise",
          message: `"${exercise?.name || "Exercise"}" has completed sets. Remove anyway?`,
          confirmLabel: "Remove",
          onConfirm: () => {
            pushUndoSnapshot();
            state.activeWorkout.exercises = state.activeWorkout.exercises.filter((e) => e.id !== workoutExerciseId);
            cleanupSoloGroups(state.activeWorkout.exercises);
            invalidateVolumeCache();
            ui.modal = null;
            queueSave();
            showToast("Exercise removed", { label: "Undo", run: performUndo });
            render();
          }
        });
        return;
      }
      pushUndoSnapshot();
      state.activeWorkout.exercises = state.activeWorkout.exercises.filter((e) => e.id !== workoutExerciseId);
      cleanupSoloGroups(state.activeWorkout.exercises);
      invalidateVolumeCache();
      queueSave();
      showToast("Exercise removed", { label: "Undo", run: performUndo });
      render();
    },
    startRest(workoutExerciseId) {
      startRest(workoutExerciseId);
    },
    finishWorkout() { finishWorkout(); },
    cancelWorkout() {
      if (!state.activeWorkout) return;
      openModal({
        type: "confirm",
        title: "Cancel workout",
        message: "Discard the current workout?",
        confirmLabel: "Cancel workout",
        onConfirm: () => {
          pushUndoSnapshot();
          state.activeWorkout = null;
          ui.restTimer = null;
          clearInterval(restInterval);
          invalidateVolumeCache();
          ui.modal = null;
          queueSave();
          setRoute("home");
          showToast("Workout cancelled", { label: "Undo", run: performUndo });
          render();
        }
      });
    },
    updateActiveWorkoutNote(value) {
      if (!state.activeWorkout) return;
      state.activeWorkout.notes = value;
      queueSave();
    },
    updateProfile(field, value) {
      if (field === "bodyWeight" || field === "barWeight") {
        state.profile[field] = Number(value || 0);
      } else {
        state.profile[field] = value;
      }
      queueSave();
      showToast("Profile saved");
    },
    updateRange(category, key, value) {
      const range = state.profile.weeklyRanges[category] || { min: 0, max: 0 };
      state.profile.weeklyRanges[category] = { ...range, [key]: Number(value || 0) };
      invalidateVolumeCache();
      queueSave();
      render();
    },
    toggleNotifications() {
      if (!("Notification" in window)) {
        showToast("Notifications not supported");
        return;
      }
      if (state.profile.notifications) {
        state.profile.notifications = false;
        queueSave();
        showToast("Notifications disabled");
        render();
        return;
      }
      Notification.requestPermission().then((perm) => {
        state.profile.notifications = perm === "granted";
        queueSave();
        showToast(perm === "granted" ? "Notifications enabled" : "Permission denied");
        render();
      });
    },
    exportFile() {
      const payload = JSON.stringify({ schema: SCHEMA_VERSION, data: state }, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `silownia-backup-${toDateKey(new Date())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Backup downloaded");
    },
    importFile() {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const text = String(reader.result || "");
            const parsed = JSON.parse(text);
            if (!parsed) throw new Error("Empty");
            const data = parsed.schema && parsed.data ? runMigrations(parsed.schema, parsed.data) : runMigrations(1, parsed);
            const sanitized = sanitizeState(data);
            pushUndoSnapshot();
            state = sanitized;
            invalidateExerciseCache();
            invalidateVolumeCache();
            saveStateNow();
            setRoute("home", true);
            showToast("Backup restored", { label: "Undo", run: performUndo });
            render();
          } catch (err) {
            console.error(err);
            showToast("Invalid backup file");
          }
        };
        reader.readAsText(file);
      });
      input.click();
    },
    openExport() {
      openModal({ type: "export" });
    },
    resetDemo() {
      openModal({
        type: "confirm",
        title: "Reset to demo data",
        message: "This wipes your current data and restores the sample workouts.",
        confirmLabel: "Reset",
        onConfirm: () => {
          pushUndoSnapshot();
          state = defaultState();
          invalidateExerciseCache();
          invalidateVolumeCache();
          saveStateNow();
          ui.modal = null;
          showToast("Demo data restored", { label: "Undo", run: performUndo });
          render();
        }
      });
    },
    closeModal() {
      ui.modal = null;
      render();
      if (ui.lastFocusBeforeModal && document.body.contains(ui.lastFocusBeforeModal)) {
        ui.lastFocusBeforeModal.focus();
      }
      ui.lastFocusBeforeModal = null;
    },
    confirmModalAction() {
      if (ui.modal?.type === "confirm" && typeof ui.modal.onConfirm === "function") {
        ui.modal.onConfirm();
      }
    },
    runToastAction() {
      if (ui.toastAction?.run) ui.toastAction.run();
      ui.toast = "";
      ui.toastAction = null;
      if (toastTimeout) clearTimeout(toastTimeout);
      render();
    },
    updatePlatesTarget(value) {
      if (!ui.modal || ui.modal.type !== "plates") return;
      ui.modal.weight = Number(value || 0);
      render();
    },
    deleteTemplate(id) {
      const template = state.templates.find((t) => t.id === id);
      if (!template) return;
      openModal({
        type: "confirm",
        title: "Delete template",
        message: `Remove "${template.name}" from My Templates? Past sessions stay in History.`,
        confirmLabel: "Delete",
        onConfirm: () => {
          pushUndoSnapshot();
          state.templates = state.templates.filter((t) => t.id !== id);
          ui.modal = null;
          queueSave();
          showToast("Template deleted", { label: "Undo", run: performUndo });
          render();
        }
      });
    },
    toggleBodyView(view) {
      const next = view === "back" ? "back" : "front";
      if (ui.bodyView === next) return;
      ui.bodyView = next;
      render();
    },
    adjustExerciseRest(workoutExerciseId, delta) {
      const we = findWorkoutExercise(workoutExerciseId);
      if (!we) return;
      const next = clamp(Number(we.restSeconds || 0) + Number(delta), 0, 600);
      we.restSeconds = next;
      if (ui.restTimer && ui.restTimer.workoutExerciseId === workoutExerciseId) {
        ui.restTimer.remaining = next;
      }
      queueSave();
      render();
    },
    setExerciseRest(workoutExerciseId, seconds) {
      const we = findWorkoutExercise(workoutExerciseId);
      if (!we) return;
      const next = clamp(Number(seconds), 0, 600);
      we.restSeconds = next;
      if (ui.restTimer && ui.restTimer.workoutExerciseId === workoutExerciseId) {
        ui.restTimer.remaining = next;
      }
      queueSave();
      render();
    },
    startLinking(kind, sourceIndex) {
      ui.linking = { kind, sourceIndex: Number(sourceIndex) };
      render();
    },
    cancelLinking() {
      ui.linking = null;
      render();
    },
    completeLinking(targetIndex) {
      if (!ui.linking) return;
      const { kind, sourceIndex } = ui.linking;
      const target = Number(targetIndex);
      if (target === sourceIndex) { ui.linking = null; render(); return; }
      const list = kind === "template" ? ui.modal?.template?.exercises : state.activeWorkout?.exercises;
      if (!list || !list[sourceIndex] || !list[target]) { ui.linking = null; render(); return; }
      const sourceGroup = list[sourceIndex].groupId;
      const targetGroup = list[target].groupId;
      if (targetGroup && targetGroup !== sourceGroup) {
        list.forEach((it) => { if (it.groupId === targetGroup) it.groupId = null; });
      }
      const groupId = sourceGroup || uid("grp");
      list[sourceIndex].groupId = groupId;
      list[target].groupId = groupId;
      const moved = list.splice(target, 1)[0];
      let insertAt = list.findIndex((it) => it.groupId === groupId);
      let lastGroup = insertAt;
      for (let i = insertAt + 1; i < list.length; i++) if (list[i].groupId === groupId) lastGroup = i;
      list.splice(lastGroup + 1, 0, moved);
      ui.linking = null;
      cleanupSoloGroups(list);
      if (kind === "workout") { invalidateVolumeCache(); queueSave(); }
      showToast("Superset linked");
      render();
    },
    ungroup(kind, groupId) {
      const list = kind === "template" ? ui.modal?.template?.exercises : state.activeWorkout?.exercises;
      if (!list) return;
      list.forEach((it) => { if (it.groupId === groupId) it.groupId = null; });
      if (kind === "workout") queueSave();
      showToast("Superset unlinked");
      render();
    },
    reorderExercise(kind, fromIndex, toIndex) {
      const list = kind === "template" ? ui.modal?.template?.exercises : state.activeWorkout?.exercises;
      if (!list) return;
      const from = Number(fromIndex);
      const to = Number(toIndex);
      if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
      const moving = list[from];
      const groupId = moving.groupId;
      if (groupId) {
        const block = list.filter((it) => it.groupId === groupId);
        const remaining = list.filter((it) => it.groupId !== groupId);
        const targetItem = list[to];
        const targetIndexAfterRemoval = remaining.indexOf(targetItem);
        const insertIndex = targetIndexAfterRemoval >= 0 ? targetIndexAfterRemoval : remaining.length;
        remaining.splice(insertIndex, 0, ...block);
        list.length = 0;
        list.push(...remaining);
      } else {
        const [moved] = list.splice(from, 1);
        list.splice(to, 0, moved);
      }
      if (kind === "workout") { invalidateVolumeCache(); queueSave(); }
      render();
    }
  };
}

function cleanupSoloGroups(list) {
  const counts = {};
  list.forEach((it) => { if (it.groupId) counts[it.groupId] = (counts[it.groupId] || 0) + 1; });
  list.forEach((it) => { if (it.groupId && counts[it.groupId] < 2) it.groupId = null; });
}

function openModal(modal) {
  ui.lastFocusBeforeModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  ui.modal = modal;
  render();
}

function startEmptyWorkout(shouldRender = true) {
  state.activeWorkout = {
    id: uid("active"),
    name: "Manual Workout",
    templateId: null,
    startedAt: toLocalDateTime(new Date()),
    notes: "",
    exercises: []
  };
  invalidateVolumeCache();
  setRoute("start");
  queueSave();
  if (shouldRender) render();
}

function startRest(workoutExerciseId) {
  const we = findWorkoutExercise(workoutExerciseId);
  if (!we) return;
  ui.restTimer = { workoutExerciseId, remaining: we.restSeconds };
  clearInterval(restInterval);
  restInterval = setInterval(() => {
    if (!ui.restTimer) {
      clearInterval(restInterval);
      restInterval = null;
      return;
    }
    const wasPositive = ui.restTimer.remaining > 0;
    ui.restTimer.remaining -= 1;
    updateRestFooterDom(workoutExerciseId);
    if (ui.restTimer.remaining <= 0) {
      clearInterval(restInterval);
      restInterval = null;
      ui.restTimer.remaining = 0;
      if (wasPositive) {
        if ("vibrate" in navigator) {
          try { navigator.vibrate([200, 100, 200]); } catch {}
        }
        showToast("Rest finished");
        showRestNotification();
      }
      ui.restTimer = null;
      updateRestFooterDom(workoutExerciseId);
    }
  }, 1000);
  updateRestFooterDom(workoutExerciseId);
}

function showRestNotification() {
  if (!state.profile.notifications) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    new Notification("Rest finished", { body: "Time for the next set.", silent: false });
  } catch {}
}

function finishWorkout() {
  if (!state.activeWorkout) return;
  const finished = { ...state.activeWorkout, finishedAt: toLocalDateTime(new Date()) };
  state.sessions.push(finished);
  state.activeWorkout = null;
  ui.restTimer = null;
  clearInterval(restInterval);
  restInterval = null;
  invalidateVolumeCache();
  saveStateNow();
  ui.selectedDate = sessionDate(finished);
  ui.viewedYear = new Date(finished.startedAt).getFullYear();
  ui.viewedMonth = new Date(finished.startedAt).getMonth();
  setRoute("history");
  showToast("Workout saved to History");
  render();
}

function bindEvents() {
  app.addEventListener("click", handleClick);
  app.addEventListener("change", handleChange);
  app.addEventListener("input", handleInput);
  app.addEventListener("submit", handleSubmit);
  app.addEventListener("keydown", handleKeydown);
  document.addEventListener("keydown", handleDocumentKeydown);
  window.addEventListener("hashchange", () => {
    const next = parseRouteFromHash();
    if (next && next !== ui.route) {
      ui.route = next;
      render();
    }
  });
  window.addEventListener("beforeunload", flushSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
}

function handleClick(event) {
  const t = event.target;
  const a = actions();

  const route = t.closest("[data-route]");
  if (route) { a.navigate(route.dataset.route); return; }

  const bodyView = t.closest("[data-body-view]");
  if (bodyView && bodyView.tagName === "BUTTON") { a.toggleBodyView(bodyView.dataset.bodyView); return; }

  const completeLink = t.closest("[data-link-target]");
  if (completeLink && ui.linking) { a.completeLinking(completeLink.dataset.linkTarget); return; }

  const cancelLink = t.closest("[data-cancel-link]");
  if (cancelLink) { a.cancelLinking(); return; }

  const startLink = t.closest("[data-start-link]");
  if (startLink) {
    const [kind, idx] = startLink.dataset.startLink.split(":");
    a.startLinking(kind, idx);
    return;
  }

  const ungroupBtn = t.closest("[data-ungroup]");
  if (ungroupBtn) {
    const [kind, gid] = ungroupBtn.dataset.ungroup.split(":");
    a.ungroup(kind, gid);
    return;
  }

  const adjustRest = t.closest("[data-adjust-rest]");
  if (adjustRest) {
    const [we, delta] = adjustRest.dataset.adjustRest.split(":");
    a.adjustExerciseRest(we, delta);
    return;
  }
  const presetRest = t.closest("[data-preset-rest]");
  if (presetRest) {
    const [we, sec] = presetRest.dataset.presetRest.split(":");
    a.setExerciseRest(we, sec);
    return;
  }

  const delTpl = t.closest("[data-delete-template]");
  if (delTpl) { a.deleteTemplate(delTpl.dataset.deleteTemplate); return; }

  const muscle = t.closest("[data-muscle]");
  if (muscle) { a.selectMuscle(muscle.dataset.muscle); return; }

  if (t.closest("[data-open-template]")) { a.openTemplate(); return; }
  const editTpl = t.closest("[data-edit-template]");
  if (editTpl) { a.openTemplate(state.templates.find((x) => x.id === editTpl.dataset.editTemplate)); return; }

  const startTpl = t.closest("[data-start-template]");
  if (startTpl) { a.startTemplate(startTpl.dataset.startTemplate); return; }

  const histView = t.closest("[data-history-view]");
  if (histView) { a.historyView(histView.dataset.historyView); return; }

  const monthShift = t.closest("[data-month-shift]");
  if (monthShift) { a.monthShift(Number(monthShift.dataset.monthShift)); return; }

  const date = t.closest("[data-date]");
  if (date) { a.selectDate(date.dataset.date); return; }

  const viewSession = t.closest("[data-view-session]");
  if (viewSession) { a.viewSession(viewSession.dataset.viewSession); return; }

  if (t.closest("[data-start-empty]")) { a.startEmpty(); return; }

  const openCatalog = t.closest("[data-open-catalog]");
  if (openCatalog) { a.openCatalog(openCatalog.dataset.openCatalog); return; }

  const addSet = t.closest("[data-add-set]");
  if (addSet) { a.addSet(addSet.dataset.addSet); return; }

  const removeSet = t.closest("[data-remove-set]");
  if (removeSet) {
    const [we, sid] = removeSet.dataset.removeSet.split(":");
    a.removeSet(we, sid);
    return;
  }

  const toggleSet = t.closest("[data-toggle-set]");
  if (toggleSet) {
    const [we, sid] = toggleSet.dataset.toggleSet.split(":");
    a.toggleSet(we, sid);
    return;
  }

  const expandSet = t.closest("[data-toggle-set-expand]");
  if (expandSet) { a.toggleSetExpand(expandSet.dataset.toggleSetExpand); return; }

  const startRestBtn = t.closest("[data-start-rest]");
  if (startRestBtn) { a.startRest(startRestBtn.dataset.startRest); return; }

  if (t.closest("[data-finish-workout]")) { a.finishWorkout(); return; }
  if (t.closest("[data-cancel-workout]")) { a.cancelWorkout(); return; }

  const togUni = t.closest("[data-toggle-unilateral]");
  if (togUni) { a.toggleUnilateral(togUni.dataset.toggleUnilateral); return; }

  const remWE = t.closest("[data-remove-workout-exercise]");
  if (remWE) { a.removeWorkoutExercise(remWE.dataset.removeWorkoutExercise); return; }

  const openPrev = t.closest("[data-open-previous]");
  if (openPrev) { a.openPrevious(openPrev.dataset.openPrevious); return; }

  const openInfo = t.closest("[data-open-exercise-info]");
  if (openInfo) { a.openExerciseInfo(openInfo.dataset.openExerciseInfo); return; }

  if (t.closest("[data-open-plates]")) { a.openPlates(); return; }

  if (t.closest("[data-export]")) { a.openExport(); return; }
  if (t.closest("[data-export-file]")) { a.exportFile(); return; }
  if (t.closest("[data-import-file]")) { a.importFile(); return; }
  if (t.closest("[data-reset-demo]")) { a.resetDemo(); return; }
  if (t.closest("[data-toggle-notifications]")) { a.toggleNotifications(); return; }

  if (t.closest("[data-close-modal]")) { a.closeModal(); return; }

  const backdrop = t.closest("[data-backdrop]");
  if (backdrop && t === backdrop) { a.closeModal(); return; }

  if (t.closest("[data-confirm-action]")) { a.confirmModalAction(); return; }
  if (t.closest("[data-toast-action]")) { a.runToastAction(); return; }

  const catCat = t.closest("[data-catalog-category]");
  if (catCat) { a.catalogCategory(catCat.dataset.catalogCategory); return; }

  if (t.closest("[data-open-custom]")) { a.openCustomExercise(); return; }
  const editCustom = t.closest("[data-edit-custom]");
  if (editCustom) { a.editCustomExercise(editCustom.dataset.editCustom); return; }
  const delCustom = t.closest("[data-delete-custom]");
  if (delCustom) { a.deleteCustomExercise(delCustom.dataset.deleteCustom); return; }

  const selectExercise = t.closest("[data-select-exercise]");
  if (selectExercise) { a.selectExerciseFromCatalog(selectExercise.dataset.selectExercise); return; }

  const removeTemplateExercise = t.closest("[data-remove-template-exercise]");
  if (removeTemplateExercise) { a.removeTemplateExercise(removeTemplateExercise.dataset.removeTemplateExercise); return; }
}

function handleChange(event) {
  const t = event.target;
  const a = actions();
  if (t.matches("[data-set-input]")) {
    const [we, sid, key] = t.dataset.setInput.split(":");
    a.updateSetField(we, sid, key, t.value);
    return;
  }
  if (t.matches("[data-progress-exercise]")) {
    a.selectProgressExercise(t.value);
    return;
  }
  if (t.matches("[data-active-workout-note]")) {
    a.updateActiveWorkoutNote(t.value);
    return;
  }
  if (t.matches("[data-exercise-note]")) {
    a.updateExerciseNote(t.dataset.exerciseNote, t.value);
    return;
  }
  if (t.matches("[data-profile]")) {
    a.updateProfile(t.dataset.profile, t.value);
    return;
  }
  if (t.matches("[data-range]")) {
    const [cat, key] = t.dataset.range.split(":");
    a.updateRange(cat, key, t.value);
    return;
  }
  if (t.matches("[data-template-field]")) {
    const [index, key] = t.dataset.templateField.split(":");
    a.updateTemplateField(index, key, t.value);
    return;
  }
}

function handleInput(event) {
  const t = event.target;
  const a = actions();
  if (t.matches("[data-history-search]")) {
    a.historySearch(t.value);
    return;
  }
  if (t.matches("[data-catalog-search]")) {
    a.catalogSearch(t.value);
    return;
  }
  if (t.matches("[data-plates-input]")) {
    a.updatePlatesTarget(t.value);
    return;
  }
  if (t.matches("[data-active-workout-note]")) {
    a.updateActiveWorkoutNote(t.value);
    return;
  }
  if (t.matches("[data-exercise-note]")) {
    a.updateExerciseNote(t.dataset.exerciseNote, t.value);
    return;
  }
  if (t.matches("[data-template-name]")) {
    if (ui.modal?.template) ui.modal.template.name = t.value;
    return;
  }
  if (t.matches("[data-template-notes]")) {
    if (ui.modal?.template) ui.modal.template.notes = t.value;
    return;
  }
}

function handleSubmit(event) {
  const t = event.target;
  const a = actions();
  if (t.matches("[data-template-form]")) {
    event.preventDefault();
    a.saveTemplate(new FormData(t));
    return;
  }
  if (t.matches("[data-custom-form]")) {
    event.preventDefault();
    a.addCustomExercise(new FormData(t));
    return;
  }
}

function handleKeydown(event) {
  if (event.target.matches("[data-muscle][role='button']") && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    actions().selectMuscle(event.target.dataset.muscle);
  }
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape" && ui.modal) {
    actions().closeModal();
    return;
  }
  if (event.key === "Escape" && ui.linking) {
    actions().cancelLinking();
    return;
  }
  trapFocusInModal(event);
}

const isSecure = typeof window !== "undefined" && (window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1");
if ("serviceWorker" in navigator && isSecure && !location.pathname.endsWith("test.html")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

async function init() {
  currentIdentity = await getIdentity();
  STORE_KEY = storageKeyFor(currentIdentity);
  SCHEMA_KEY = `${STORE_KEY}-schema`;
  migrateLegacyIfNeeded();
  state = loadState();
  ui.route = state.activeWorkout ? "start" : "home";
  bindEvents();
  const initialHash = `#/${ui.route}`;
  if (!location.hash) {
    try { history.replaceState(null, "", initialHash); } catch { location.hash = initialHash; }
  } else if (location.hash !== initialHash) {
    try { history.replaceState(null, "", initialHash); } catch {}
  }
  render();
  if (typeof window !== "undefined" && typeof window.__hideBootSplash === "function") {
    window.__hideBootSplash();
  }
}

init().catch((err) => {
  console.error("init failed", err);
  if (typeof window !== "undefined") {
    const evt = new ErrorEvent("error", { message: String(err && err.message || err), error: err });
    window.dispatchEvent(evt);
  }
});

if (typeof window !== "undefined") {
  window.__SILOWNIA__ = {
    oneRm,
    sessionVolume,
    weeklyVolume,
    volumeStatus,
    volumePercent,
    calculatePlates,
    isPersonalRecord,
    suggestNextSet,
    runMigrations,
    sanitizeState,
    defaultState,
    DEFAULT_EXERCISES_LIST,
    SCHEMA_VERSION
  };
}
