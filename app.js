/** @typedef {{ code: string|null, label: string }} Option */
/** @typedef {{ code: string, label: string, label_en: string }} GodMeta */

const RUN_MODE_HELP =
  "런 모드 = 이번 플레이가 어떤 신 번뜩임 풀을 쓰는지\n" +
  "· 기본: 일반 런 (기본-{신})\n" +
  "· 출격: 출격(assault) 런 (출격-{신})\n" +
  "· 전체: 기본 + 출격 모두 표시\n" +
  "※ god_type=none 일반 번뜩임은 조회에서 제외됩니다.";

const TAG_STATE_HELP =
  "태그 선택 안내\n" +
  "· 무관: 이 태그는 조건에 쓰지 않음\n" +
  "· 포함: 카드에 있음 → 이 태그 카드를 제외하는 번뜩임 제거\n" +
  "· 없음: 없음 → 이 태그를 요구하는 번뜩임 제거\n\n" +
  "소멸(exhaust): 카드 extra_tag와 TALENT_EXHAUST(소멸)를 동일하게 처리합니다.";

const RESULT_COLUMNS = [
  { key: "sheet", label: "시트", mono: false },
  { key: "description", label: "설명", mono: false },
  { key: "conditions", label: "조건", mono: false },
  { key: "weight", label: "가중치", mono: false },
  { key: "probability", label: "확률", mono: false },
  { key: "mode", label: "모드", mono: false },
  { key: "god", label: "신", mono: false },
  { key: "id", label: "ID", mono: true },
];

const COLUMN_DEFAULT_WIDTH_PX = {
  sheet: 96,
  description: 240,
  conditions: 300,
  weight: 72,
  probability: 56,
  mode: 64,
  god: 100,
  id: 180,
};

const VISIBLE_COLS_KEY = "spark-lookup-visible-cols";
const COLUMN_WIDTHS_KEY = "spark-lookup-col-widths";
const RESULT_SORT_KEY = "spark-lookup-result-sort";
const SEARCH_HISTORY_KEY = "spark-lookup-search-history";
const MAX_SEARCH_HISTORY = 12;

/** @type {Set<string>} */
const SORTABLE_RESULT_COLUMNS = new Set(["probability", "god", "weight", "sheet"]);

/** @type {{ key: string|null, dir: "asc"|"desc" }} */
let resultSort = { key: null, dir: "desc" };

/** @type {Set<string>} */
let visibleColumnKeys = new Set();

/** @type {Record<string, number>} */
let columnWidths = {};

/** @type {{ id: string, label: string, filters: object, entries: object[], keys: string[], count: number, savedAt: string, sig: string }[]} */
let searchHistory = [];

/** @type {{ id: string, sig: string, label: string, filters: object, entries: object[], keys: string[], count: number, selected: boolean }[]} */
let compareStaging = [];

/** @type {Set<string>} */
let historyComparePick = new Set();

/** @type {string|null} */
let compareAId = null;

/** @type {string|null} */
let compareBId = null;

/** @type {object|null} */
let lastFilters = null;

/** @type {object[]} */
let lastMatched = [];

/** @type {{ meta: object, entries: object[] } | null} */
let bundle = null;

/** @type {Map<string, number>} */
let godRank = new Map();

/** @type {Map<string, string>} */
let godLabelToCode = new Map();

function sortGodCodes(codes) {
  const order = bundle?.meta?.god_order ?? [];
  return [...new Set(codes)].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function resolveGodCodes(entry) {
  if (Array.isArray(entry.god_codes) && entry.god_codes.length) {
    return sortGodCodes(entry.god_codes);
  }
  if (entry.god_code) return [entry.god_code];
  const names = String(entry.god ?? "")
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean);
  return sortGodCodes(names.map((n) => godLabelToCode.get(n)).filter(Boolean));
}


function isGodCommonEntry(entry) {
  if (String(entry.sheet ?? "").includes("신공통")) return true;
  return resolveGodCodes(entry).length > 1;
}

function applyRowGodStyle(tr, entry) {
  tr.className = "";
  tr.style.removeProperty("background");
  tr.style.removeProperty("box-shadow");

  if (isGodCommonEntry(entry)) return;

  const codes = resolveGodCodes(entry);
  if (codes.length !== 1) return;

  tr.className = `row-god-${codes[0].toLowerCase()}`;
}

function entryWeightNum(weight) {
  if (typeof weight === "number") return weight;
  const s = String(weight);
  const range = s.match(/^(\d+)~(\d+)$/);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatProb(p) {
  return p > 0 ? `${(p * 100).toFixed(1)}%` : "—";
}

/** @param {object[]} rawEntries */
function computeRawProbabilities(rawEntries) {
  /** @type {Map<string, number>} */
  const godTotals = new Map();
  /** @type {Map<string, Set<string>>} */
  const godsByMode = new Map();
  for (const e of rawEntries) {
    const god = e.god_code;
    if (!god) continue;
    const mode = e.mode;
    const w = entryWeightNum(e.weight);
    const key = `${mode}\0${god}`;
    godTotals.set(key, (godTotals.get(key) ?? 0) + w);
    if (!godsByMode.has(mode)) godsByMode.set(mode, new Set());
    godsByMode.get(mode).add(god);
  }
  /** @type {Map<string, number>} */
  const probs = new Map();
  for (const e of rawEntries) {
    const god = e.god_code;
    const mode = e.mode;
    const gCount = godsByMode.get(mode)?.size ?? 0;
    const total = godTotals.get(`${mode}\0${god}`) ?? 0;
    const w = entryWeightNum(e.weight);
    probs.set(
      e.id,
      gCount > 0 && total > 0 && w > 0 ? (1 / gCount) * (w / total) : 0
    );
  }
  return probs;
}

function attachProbabilities(entries) {
  for (const e of entries) {
    const p = e._prob;
    e.probability = p != null ? formatProb(p) : "—";
  }
}

function sparkMatchesCost(min, max, cardCost) {
  return min <= cardCost && cardCost <= max;
}

function effectKeyStr(entry) {
  return JSON.stringify(entry.effect_key ?? []);
}

function godSortKey(godField) {
  const parts = String(godField)
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean);
  const ranks = parts.map((p) => godRank.get(p) ?? 99);
  const primary = ranks.length ? Math.min(...ranks) : 99;
  return [primary, godField];
}

function mergeGodClones(members) {
  const gods = [...new Set(members.map((e) => e.god))].sort(
    (a, b) => (godRank.get(a) ?? 99) - (godRank.get(b) ?? 99)
  );
  const ids = [...new Set(members.map((e) => e.id))].sort();
  const weights = members.map((e) => e.weight);
  const uniqW = new Set(weights);
  const weight =
    uniqW.size === 1 ? weights[0] : `${Math.min(...weights)}~${Math.max(...weights)}`;
  const first = members[0];
  const god_codes = sortGodCodes(
    members.map((e) => e.god_code).filter(Boolean)
  );
  return {
    id: ids.join(", "),
    sheet: `${first.mode}-신공통`,
    mode: first.mode,
    god: gods.join(" · "),
    god_codes,
    description: first.description,
    conditions: first.conditions ?? "",
    weight,
  };
}

function mergeSameGodVariants(members) {
  const first = members[0];
  const ids = [...new Set(members.map((e) => e.id))].sort();
  const weights = members.map((e) => e.weight);
  const uniqW = new Set(weights);
  const weight =
    uniqW.size === 1 ? weights[0] : `${Math.min(...weights)}~${Math.max(...weights)}`;
  const descs = [...new Set(members.map((e) => e.description))];
  const description = descs.length === 1 ? descs[0] : descs.join(" / ");
  return {
    id: ids.join(", "),
    sheet: first.sheet,
    mode: first.mode,
    god: first.god,
    god_code: first.god_code,
    description,
    conditions: first.conditions ?? "",
    weight,
  };
}

function applyDedupe(matched, dedupe, rawProbs) {
  if (!dedupe) {
    return matched.map((e) => {
      const p = rawProbs.get(e.id) ?? 0;
      return { ...e, _prob: p, probability: formatProb(p) };
    });
  }
  /** @type {Map<string, object[]>} */
  const buckets = new Map();
  for (const e of matched) {
    const key = `${effectKeyStr(e)}\0${e.mode}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  }
  const merged = [];
  for (const members of buckets.values()) {
    const p = members.reduce((s, e) => s + (rawProbs.get(e.id) ?? 0), 0);
    if (members.length === 1) {
      merged.push({ ...members[0], _prob: p, probability: formatProb(p) });
      continue;
    }
    const uniqueGods = new Set(members.map((e) => e.god));
    const row =
      uniqueGods.size >= 2 ? mergeGodClones(members) : mergeSameGodVariants(members);
    merged.push({ ...row, _prob: p, probability: formatProb(p) });
  }
  return merged;
}

function getFilters() {
  const cost = Number(document.querySelector('input[name="cost"]:checked')?.value ?? "2");
  const typeCode = document.querySelector('input[name="type"]:checked')?.dataset.code ?? "";
  const typeLabel = document.querySelector('input[name="type"]:checked')?.value ?? "스킬";
  const mode = document.querySelector('input[name="mode"]:checked')?.value ?? "기본";
  const classCode =
    document.querySelector('input[name="class"]:checked')?.dataset.code ?? "";
  const classLabel =
    document.querySelector('input[name="class"]:checked')?.value ?? "전체";
  const dedupe = /** @type {HTMLInputElement} */ (document.getElementById("dedupe")).checked;

  /** @type {Set<string>} */
  const gods = new Set();
  for (const el of document.querySelectorAll('input[name="god"]:checked')) {
    gods.add(/** @type {HTMLInputElement} */ (el).value);
  }

  /** @type {Record<string, string>} */
  const tagStates = {};
  for (const el of document.querySelectorAll("[data-tag-state]")) {
    if (/** @type {HTMLInputElement} */ (el).checked) {
      const code = el.getAttribute("data-tag-code");
      if (code) tagStates[code] = el.value;
    }
  }

  return {
    cost,
    typeCode,
    typeLabel,
    mode,
    classCode,
    classLabel,
    gods: [...gods].sort(),
    tagStates,
    dedupe,
  };
}

function filtersSignature(f) {
  return JSON.stringify({
    cost: f.cost,
    typeCode: f.typeCode,
    mode: f.mode,
    classCode: f.classCode,
    gods: f.gods,
    tagStates: f.tagStates,
    dedupe: f.dedupe,
  });
}

function filtersSummary(f) {
  const parts = [`${f.cost}코`, f.typeLabel.replace(/\s*\([^)]*\)/, ""), f.mode];
  if (f.classCode) parts.push(f.classLabel);
  const tagNotes = Object.entries(f.tagStates)
    .filter(([, v]) => v !== "무관")
    .map(([k, v]) => `${k}:${v}`);
  if (tagNotes.length) parts.push(tagNotes.join(","));
  if (f.gods.length && bundle && f.gods.length < bundle.meta.god_order.length) {
    const labels = f.gods
      .map((c) => bundle.meta.gods.find((g) => g.code === c)?.label ?? c)
      .join("·");
    parts.push(labels);
  }
  return parts.join(" · ");
}

function entryCompareKey(entry, dedupe) {
  if (dedupe) return `${effectKeyStr(entry)}\0${entry.mode}`;
  return String(entry.id);
}

function computeMatched(filters) {
  if (!bundle) return [];
  const raw = bundle.entries.filter((e) => matchEntry(e, filters));
  const rawProbs = computeRawProbabilities(raw);
  let matched = applyDedupe(raw, filters.dedupe, rawProbs);
  attachProbabilities(matched);
  matched = sortMatched(matched, resultSort);
  return matched;
}

function slimEntryForHistory(entry) {
  return {
    id: entry.id,
    sheet: entry.sheet,
    mode: entry.mode,
    god: entry.god,
    god_code: entry.god_code,
    god_codes: entry.god_codes,
    description: entry.description,
    conditions: entry.conditions ?? "",
    weight: entry.weight,
    probability: entry.probability ?? "",
    effect_key: entry.effect_key,
  };
}

function loadSearchHistory() {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveSearchHistoryStore() {
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(searchHistory));
}

function createHistoryItem(filters, matched) {
  const sig = filtersSignature(filters);
  const keys = matched.map((e) => entryCompareKey(e, filters.dedupe));
  return {
    id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sig,
    label: filtersSummary(filters),
    filters: { ...filters, gods: [...filters.gods] },
    entries: matched.map(slimEntryForHistory),
    keys,
    count: matched.length,
    savedAt: new Date().toISOString(),
  };
}

function appendToHistory(item) {
  const existing = searchHistory.findIndex((h) => h.sig === item.sig);
  if (existing >= 0) searchHistory.splice(existing, 1);
  searchHistory.unshift(item);
  if (searchHistory.length > MAX_SEARCH_HISTORY) {
    searchHistory = searchHistory.slice(0, MAX_SEARCH_HISTORY);
  }
  if (compareAId && !searchHistory.some((h) => h.id === compareAId)) compareAId = null;
  if (compareBId && !searchHistory.some((h) => h.id === compareBId)) compareBId = null;
  historyComparePick.forEach((id) => {
    if (!searchHistory.some((h) => h.id === id)) historyComparePick.delete(id);
  });
  saveSearchHistoryStore();
}

function addCurrentToStaging() {
  if (!lastFilters || !lastMatched.length) {
    window.alert("조건에 맞는 번뜩임이 없습니다. 먼저 카드 조건을 설정하세요.");
    return;
  }
  const sig = filtersSignature(lastFilters);
  if (compareStaging.some((s) => s.sig === sig)) {
    window.alert("이미 담기 목록에 있는 조건입니다.");
    return;
  }
  const item = createHistoryItem(lastFilters, lastMatched);
  compareStaging.push({
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sig: item.sig,
    label: item.label,
    filters: item.filters,
    entries: item.entries,
    keys: item.keys,
    count: item.count,
    selected: true,
  });
  renderStagingPanel();
}

function commitStagingToHistory() {
  const picked = compareStaging.filter((s) => s.selected);
  if (!picked.length) {
    window.alert("비교 목록에 추가할 항목을 선택하세요.");
    return;
  }
  for (const s of picked) {
    appendToHistory(createHistoryItem(s.filters, s.entries));
  }
  compareStaging = compareStaging.filter((s) => !s.selected);
  renderStagingPanel();
  renderHistoryPanel();
}

function clearStaging() {
  compareStaging = [];
  renderStagingPanel();
}

function toggleStagingPick(id, checked) {
  const item = compareStaging.find((s) => s.id === id);
  if (item) item.selected = checked;
}

function toggleHistoryComparePick(id, checked) {
  if (checked) {
    if (historyComparePick.size >= 2) {
      const first = [...historyComparePick][0];
      historyComparePick.delete(first);
    }
    historyComparePick.add(id);
  } else {
    historyComparePick.delete(id);
  }
  renderHistoryPanel();
  updateCompareRunButton();
}

function runCompareFromSelection() {
  if (historyComparePick.size !== 2) return;
  const [a, b] = [...historyComparePick];
  compareAId = a;
  compareBId = b;
  renderHistoryPanel();
  renderComparePanel();
}

function updateCompareRunButton() {
  const btn = document.getElementById("run-compare");
  if (!btn) return;
  const n = historyComparePick.size;
  btn.disabled = n !== 2;
  btn.textContent = n === 2 ? "비교하기" : `비교하기 (${n}/2)`;
}

function removeHistoryItem(id) {
  searchHistory = searchHistory.filter((h) => h.id !== id);
  historyComparePick.delete(id);
  if (compareAId === id) compareAId = null;
  if (compareBId === id) compareBId = null;
  saveSearchHistoryStore();
  renderHistoryPanel();
  renderComparePanel();
  updateCompareRunButton();
}

function removeStagingItem(id) {
  compareStaging = compareStaging.filter((s) => s.id !== id);
  renderStagingPanel();
}

function renderStagingPanel() {
  const list = document.getElementById("staging-list");
  const addBtn = document.getElementById("stage-current");
  const commitBtn = document.getElementById("commit-staging");
  if (!list) return;

  if (addBtn) {
    addBtn.disabled = !lastMatched.length;
  }
  if (commitBtn) {
    const n = compareStaging.filter((s) => s.selected).length;
    commitBtn.disabled = n === 0;
    commitBtn.textContent = n ? `선택 항목 비교 목록에 추가 (${n})` : "선택 항목 비교 목록에 추가";
  }

  list.replaceChildren();
  if (!compareStaging.length) {
    const empty = document.createElement("p");
    empty.className = "hint history-empty";
    empty.textContent = "담기 목록이 비어 있습니다.";
    list.appendChild(empty);
    return;
  }

  for (const item of compareStaging) {
    const row = document.createElement("div");
    row.className = "history-item staging-item";

    const label = document.createElement("label");
    label.className = "staging-check";
    label.innerHTML = `<input type="checkbox" ${item.selected ? "checked" : ""} /> <strong>${escapeHtml(item.label)}</strong> <span class="history-count">${item.count}건</span>`;
    label.querySelector("input").addEventListener("change", (ev) => {
      toggleStagingPick(item.id, /** @type {HTMLInputElement} */ (ev.target).checked);
      renderStagingPanel();
    });

    const btnRemove = document.createElement("button");
    btnRemove.type = "button";
    btnRemove.className = "link-btn";
    btnRemove.textContent = "삭제";
    btnRemove.addEventListener("click", () => removeStagingItem(item.id));

    row.append(label, btnRemove);
    list.appendChild(row);
  }
}

function applyFilters(filters) {
  const costEl = document.querySelector(`input[name="cost"][value="${filters.cost}"]`);
  if (costEl) /** @type {HTMLInputElement} */ (costEl).checked = true;

  for (const el of document.querySelectorAll('input[name="type"]')) {
    const input = /** @type {HTMLInputElement} */ (el);
    input.checked = input.dataset.code === (filters.typeCode ?? "");
  }

  const modeEl = document.querySelector(`input[name="mode"][value="${filters.mode}"]`);
  if (modeEl) /** @type {HTMLInputElement} */ (modeEl).checked = true;

  for (const el of document.querySelectorAll('input[name="class"]')) {
    const input = /** @type {HTMLInputElement} */ (el);
    input.checked = input.dataset.code === (filters.classCode ?? "");
  }

  const godSet = new Set(filters.gods ?? []);
  for (const el of document.querySelectorAll('input[name="god"]')) {
    const input = /** @type {HTMLInputElement} */ (el);
    input.checked = godSet.has(input.value);
  }

  for (const [code, state] of Object.entries(filters.tagStates ?? {})) {
    const el = document.querySelector(`input[name="tag-${code}"][value="${state}"]`);
    if (el) /** @type {HTMLInputElement} */ (el).checked = true;
  }

  const dedupeEl = /** @type {HTMLInputElement} */ (document.getElementById("dedupe"));
  if (dedupeEl) dedupeEl.checked = !!filters.dedupe;
}

function renderHistoryPanel() {
  const list = document.getElementById("history-list");
  if (!list) return;
  list.replaceChildren();

  if (!searchHistory.length) {
    const empty = document.createElement("p");
    empty.className = "hint history-empty";
    empty.textContent = "담기 → 선택 → 비교 목록에 추가하세요.";
    list.appendChild(empty);
    updateCompareRunButton();
    return;
  }

  for (const item of searchHistory) {
    const row = document.createElement("div");
    row.className = "history-item";
    const isPicked = historyComparePick.has(item.id);
    const isActive = item.id === compareAId || item.id === compareBId;
    if (isPicked || isActive) row.classList.add("history-item-active");

    const label = document.createElement("label");
    label.className = "staging-check";
    const slot =
      item.id === compareAId ? "A" : item.id === compareBId ? "B" : isPicked ? "·" : "";
    label.innerHTML = `<input type="checkbox" ${isPicked ? "checked" : ""} /> <strong>${escapeHtml(item.label)}</strong> <span class="history-count">${item.count}건${slot ? ` · ${slot}` : ""}</span>`;
    label.querySelector("input").addEventListener("change", (ev) => {
      toggleHistoryComparePick(item.id, /** @type {HTMLInputElement} */ (ev.target).checked);
    });

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const btnLoad = document.createElement("button");
    btnLoad.type = "button";
    btnLoad.className = "link-btn history-load-btn";
    btnLoad.textContent = "불러오기";
    btnLoad.addEventListener("click", () => {
      applyFilters(item.filters);
      refresh();
    });

    const btnRemove = document.createElement("button");
    btnRemove.type = "button";
    btnRemove.className = "link-btn";
    btnRemove.textContent = "삭제";
    btnRemove.addEventListener("click", () => removeHistoryItem(item.id));

    actions.append(btnLoad, btnRemove);
    row.append(label, actions);
    list.appendChild(row);
  }
  updateCompareRunButton();
}

function renderCompareList(containerId, entries, emptyText) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.replaceChildren();
  if (!entries.length) {
    const p = document.createElement("p");
    p.className = "hint compare-empty";
    p.textContent = emptyText;
    el.appendChild(p);
    return;
  }
  const ul = document.createElement("ul");
  ul.className = "compare-list";
  for (const e of entries) {
    const li = document.createElement("li");
    li.className = "compare-list-item";
    const godClass = isGodCommonEntry(e) ? "" : rowGodClassName(e);
    if (godClass) li.classList.add(godClass);
    li.innerHTML = `<span class="compare-desc">${escapeHtml(e.description)}</span><span class="compare-sub">${escapeHtml(e.sheet)} · w${escapeHtml(String(e.weight))}</span>`;
    ul.appendChild(li);
  }
  el.appendChild(ul);
}

function rowGodClassName(entry) {
  const codes = resolveGodCodes(entry);
  if (codes.length === 1) return `row-god-${codes[0].toLowerCase()}`;
  return "";
}

function renderComparePanel() {
  const panel = document.getElementById("compare-panel");
  if (!panel) return;

  const itemA = searchHistory.find((h) => h.id === compareAId);
  const itemB = searchHistory.find((h) => h.id === compareBId);

  if (!itemA || !itemB) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  document.getElementById("compare-a-label").textContent = `A: ${itemA.label} (${itemA.count}건)`;
  document.getElementById("compare-b-label").textContent = `B: ${itemB.label} (${itemB.count}건)`;

  const setA = new Set(itemA.keys);
  const setB = new Set(itemB.keys);
  const onlyA = itemA.entries.filter((_, i) => !setB.has(itemA.keys[i]));
  const onlyB = itemB.entries.filter((_, i) => !setA.has(itemB.keys[i]));
  const common = itemA.entries.filter((_, i) => setB.has(itemA.keys[i]));

  document.getElementById("diff-only-a-count").textContent = `${onlyA.length}건`;
  document.getElementById("diff-only-b-count").textContent = `${onlyB.length}건`;
  document.getElementById("diff-common-count").textContent = `${common.length}건`;

  onlyA.sort(compareBySheetThenWeight);
  onlyB.sort(compareBySheetThenWeight);

  renderCompareList("diff-only-a", onlyA, "A에만 있는 번뜩임 없음");
  renderCompareList("diff-only-b", onlyB, "B에만 있는 번뜩임 없음");
  renderCompareList("diff-common", common, "공통 번뜩임 없음");
}

function matchEntry(e, f) {
  if (!sparkMatchesCost(e.cost_min, e.cost_max, f.cost)) return false;

  if (f.typeCode === "CARD_ATK" && !e.ok_atk) return false;
  if (f.typeCode === "CARD_SKILL" && !e.ok_skill) return false;
  if (f.typeCode === "CARD_POWER" && !e.ok_power) return false;

  if (f.mode === "기본" && e.mode !== "기본") return false;
  if (f.mode === "출격" && e.mode !== "출격") return false;

  const godSet = new Set(f.gods ?? []);
  if (!godSet.size) return false;
  const godOrder = bundle.meta.god_order;
  if (godSet.size < godOrder.length && !godSet.has(e.god_code)) return false;

  const clsMap = {
    striker: "ok_striker",
    knight: "ok_knight",
    ranger: "ok_ranger",
    hunter: "ok_hunter",
    psionic: "ok_psionic",
    controller: "ok_controller",
  };
  if (f.classCode && clsMap[f.classCode] && !e[clsMap[f.classCode]]) return false;

  for (const [code, state] of Object.entries(f.tagStates)) {
    if (state === "무관") continue;
    if (code === "exhaust") {
      if (state === "포함" && e.need_exc_exhaust) return false;
      if (state === "없음" && e.need_inc_exhaust) return false;
      continue;
    }
    if (state === "포함" && e[`ban_${code}`]) return false;
    if (state === "없음" && e[`req_${code}`]) return false;
  }
  return true;
}

function loadVisibleColumns() {
  try {
    const raw = localStorage.getItem(VISIBLE_COLS_KEY);
    if (!raw) return new Set(RESULT_COLUMNS.map((c) => c.key));
    const keys = JSON.parse(raw);
    if (!Array.isArray(keys) || !keys.length) return new Set(RESULT_COLUMNS.map((c) => c.key));
    const valid = keys.filter((k) => RESULT_COLUMNS.some((c) => c.key === k));
    return valid.length ? new Set(valid) : new Set(RESULT_COLUMNS.map((c) => c.key));
  } catch {
    return new Set(RESULT_COLUMNS.map((c) => c.key));
  }
}

function saveVisibleColumns() {
  localStorage.setItem(VISIBLE_COLS_KEY, JSON.stringify([...visibleColumnKeys]));
}

function loadColumnWidths() {
  try {
    const raw = localStorage.getItem(COLUMN_WIDTHS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return {};
    /** @type {Record<string, number>} */
    const out = {};
    for (const [key, val] of Object.entries(data)) {
      const n = Number(val);
      if (RESULT_COLUMNS.some((c) => c.key === key) && Number.isFinite(n) && n >= 48) {
        out[key] = Math.round(n);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveColumnWidths() {
  localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths));
}

function getColumnWidth(key) {
  return columnWidths[key] ?? COLUMN_DEFAULT_WIDTH_PX[key] ?? 120;
}

function visibleColumns() {
  return RESULT_COLUMNS.filter((c) => visibleColumnKeys.has(c.key));
}

function rowCellValue(entry, key) {
  const v = entry[key];
  if (v === undefined || v === null) return "";
  return String(v);
}

function isCommonSheet(sheet) {
  return String(sheet ?? "").includes("신공통");
}

function compareBySheetThenWeight(a, b) {
  const aCommon = isCommonSheet(a.sheet);
  const bCommon = isCommonSheet(b.sheet);
  if (aCommon !== bCommon) return aCommon ? -1 : 1;

  const sheetCmp = String(a.sheet ?? "").localeCompare(String(b.sheet ?? ""), "ko");
  if (sheetCmp !== 0) return sheetCmp;

  const wa = typeof a.weight === "number" ? a.weight : 0;
  const wb = typeof b.weight === "number" ? b.weight : 0;
  if (wa !== wb) return wb - wa;
  return String(a.id).localeCompare(String(b.id));
}

function probNum(entry) {
  if (entry._prob != null) return entry._prob;
  const s = String(entry.probability ?? "").replace("%", "").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n / 100 : 0;
}

function compareByGodName(a, b) {
  const ka = godSortKey(a.god);
  const kb = godSortKey(b.god);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  return String(a.god ?? "").localeCompare(String(b.god ?? ""), "ko");
}

function sortMatched(entries, sort) {
  if (!sort.key) {
    const commonRows = entries.filter((e) => isCommonSheet(e.sheet));
    const godRows = entries.filter((e) => !isCommonSheet(e.sheet));
    commonRows.sort(compareBySheetThenWeight);
    godRows.sort(compareBySheetThenWeight);
    return [...commonRows, ...godRows];
  }

  const dir = sort.dir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case "probability":
        cmp = probNum(a) - probNum(b);
        break;
      case "weight":
        cmp = entryWeightNum(a.weight) - entryWeightNum(b.weight);
        break;
      case "god":
        cmp = compareByGodName(a, b);
        break;
      case "sheet":
        cmp = String(a.sheet ?? "").localeCompare(String(b.sheet ?? ""), "ko");
        break;
      default:
        break;
    }
    if (cmp !== 0) return cmp * dir;
    return compareBySheetThenWeight(a, b);
  });
}

function loadResultSort() {
  try {
    const raw = localStorage.getItem(RESULT_SORT_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return;
    if (data.key != null && !SORTABLE_RESULT_COLUMNS.has(data.key)) return;
    resultSort = {
      key: data.key ?? null,
      dir: data.dir === "asc" ? "asc" : "desc",
    };
  } catch {
    /* ignore */
  }
}

function saveResultSort() {
  localStorage.setItem(RESULT_SORT_KEY, JSON.stringify(resultSort));
}

function cycleResultSort(key) {
  if (resultSort.key === key) {
    if (resultSort.dir === "desc") resultSort.dir = "asc";
    else {
      resultSort.key = null;
      resultSort.dir = "desc";
    }
  } else {
    resultSort.key = key;
    resultSort.dir = "desc";
  }
  saveResultSort();
  buildResultTableHead();
  refresh();
}

function buildResultTableHead() {
  const table = document.querySelector(".results table");
  const colgroup = document.getElementById("result-cols");
  const thead = document.querySelector(".results table thead tr");
  colgroup.replaceChildren();
  thead.replaceChildren();

  for (const col of visibleColumns()) {
    const width = getColumnWidth(col.key);
    const colEl = document.createElement("col");
    colEl.dataset.col = col.key;
    colEl.style.width = `${width}px`;
    colgroup.appendChild(colEl);

    const th = document.createElement("th");
    th.className = "col-header";
    th.dataset.col = col.key;
    th.style.width = `${width}px`;
    th.style.minWidth = `${width}px`;
    th.style.maxWidth = `${width}px`;
    const label = document.createElement("span");
    label.className = "col-label";
    label.textContent = col.label;
    if (SORTABLE_RESULT_COLUMNS.has(col.key)) {
      th.classList.add("col-sortable");
      if (resultSort.key === col.key) {
        th.classList.add(resultSort.dir === "asc" ? "col-sorted-asc" : "col-sorted-desc");
      }
      label.title = "클릭하여 정렬 (내림차순 → 오름차순 → 기본)";
      label.addEventListener("click", (ev) => {
        ev.stopPropagation();
        cycleResultSort(col.key);
      });
    }
    th.appendChild(label);
    const resizer = document.createElement("span");
    resizer.className = "col-resizer";
    resizer.title = "드래그하여 열 너비 조절";
    resizer.setAttribute("aria-hidden", "true");
    th.appendChild(resizer);
    attachColumnResizer(resizer, col.key, colEl, th);
    thead.appendChild(th);
  }

  syncTableWidth(table);
}

function syncTableWidth(table) {
  const total = visibleColumns().reduce((sum, c) => sum + getColumnWidth(c.key), 0);
  const wrap = table.closest(".table-wrap");
  const minW = wrap ? Math.max(total, wrap.clientWidth) : total;
  table.style.width = `${minW}px`;
}

function attachColumnResizer(handle, key, colEl, th) {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = getColumnWidth(key);
    const table = document.querySelector(".results table");

    const onMove = (ev) => {
      const next = Math.max(56, Math.min(800, startW + ev.clientX - startX));
      columnWidths[key] = next;
      colEl.style.width = `${next}px`;
      th.style.width = `${next}px`;
      th.style.minWidth = `${next}px`;
      th.style.maxWidth = `${next}px`;
      syncTableWidth(table);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("col-resizing");
      saveColumnWidths();
    };

    document.body.classList.add("col-resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function appendResultRow(tbody, entry) {
  const tr = document.createElement("tr");
  applyRowGodStyle(tr, entry);
  for (const col of visibleColumns()) {
    const td = document.createElement("td");
    if (col.mono) td.className = "mono";
    td.dataset.col = col.key;
    td.textContent = rowCellValue(entry, col.key);
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
}

function buildColumnPicker() {
  const row = document.getElementById("column-picker");
  row.replaceChildren();
  for (const col of RESULT_COLUMNS) {
    const id = `col-${col.key}`;
    const label = document.createElement("label");
    label.className = "inline";
    const checked = visibleColumnKeys.has(col.key) ? "checked" : "";
    label.innerHTML = `<input type="checkbox" id="${id}" data-col-key="${col.key}" ${checked} /> ${escapeHtml(col.label)}`;
    row.appendChild(label);
    label.querySelector("input").addEventListener("change", (ev) => {
      const input = /** @type {HTMLInputElement} */ (ev.target);
      const key = input.getAttribute("data-col-key");
      if (!key) return;
      if (input.checked) {
        visibleColumnKeys.add(key);
      } else if (visibleColumnKeys.size <= 1) {
        input.checked = true;
        return;
      } else {
        visibleColumnKeys.delete(key);
      }
      saveVisibleColumns();
      buildResultTableHead();
      refresh();
    });
  }

  document.getElementById("cols-all").addEventListener("click", () => {
    visibleColumnKeys = new Set(RESULT_COLUMNS.map((c) => c.key));
    saveVisibleColumns();
    row.querySelectorAll("input[type=checkbox]").forEach((el) => {
      /** @type {HTMLInputElement} */ (el).checked = true;
    });
    buildResultTableHead();
    refresh();
  });

  document.getElementById("cols-minimal").addEventListener("click", () => {
    visibleColumnKeys = new Set(["description", "conditions", "weight", "probability"]);
    saveVisibleColumns();
    row.querySelectorAll("input[type=checkbox]").forEach((el) => {
      const key = el.getAttribute("data-col-key");
      /** @type {HTMLInputElement} */ (el).checked = key ? visibleColumnKeys.has(key) : false;
    });
    buildResultTableHead();
    refresh();
  });

  document.getElementById("cols-reset-width").addEventListener("click", () => {
    columnWidths = {};
    saveColumnWidths();
    buildResultTableHead();
    refresh();
  });
}

function refresh() {
  if (!bundle) return;
  const f = getFilters();
  const matched = computeMatched(f);
  lastFilters = f;
  lastMatched = matched;

  const tbody = document.getElementById("result-body");
  const colCount = visibleColumns().length;
  tbody.replaceChildren();
  if (!matched.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = colCount || 1;
    td.className = "empty";
    td.textContent = "조건에 맞는 번뜩임 없음";
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const e of matched) {
      appendResultRow(tbody, e);
    }
  }
  document.getElementById("count-label").textContent = `${matched.length}건`;
  renderStagingPanel();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addRadios(containerId, name, options, defaultIndex, onChange) {
  const el = document.getElementById(containerId);
  options.forEach((opt, i) => {
    const id = `${name}-${i}`;
    const label = document.createElement("label");
    label.className = "inline";
    label.innerHTML = `<input type="radio" name="${name}" id="${id}" value="${escapeHtml(
      opt.value
    )}" data-code="${escapeHtml(opt.code ?? "")}" ${i === defaultIndex ? "checked" : ""} /> ${escapeHtml(opt.label)}`;
    el.appendChild(label);
  });
  el.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", onChange);
  });
}

function showHelp(title, body) {
  document.getElementById("help-title").textContent = title;
  document.getElementById("help-body").textContent = body;
  /** @type {HTMLDialogElement} */ (document.getElementById("help-dialog")).showModal();
}

function buildUI(meta) {
  addRadios(
    "cost-row",
    "cost",
    [0, 1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n), code: "" })),
    2,
    refresh
  );

  addRadios(
    "type-row",
    "type",
    meta.card_types.map((t) => ({
      value: t.label,
      label: t.label,
      code: t.code ?? "",
    })),
    2,
    refresh
  );

  addRadios(
    "mode-row",
    "mode",
    ["전체", "기본", "출격"].map((m) => ({ value: m, label: m, code: "" })),
    1,
    refresh
  );

  const godRow = document.getElementById("god-row");
  for (const g of meta.gods) {
    const id = `god-${g.code}`;
    const label = document.createElement("label");
    label.className = "inline";
    label.innerHTML = `<input type="checkbox" name="god" id="${id}" value="${g.code}" checked /> ${escapeHtml(g.label)}`;
    godRow.appendChild(label);
    label.querySelector("input").addEventListener("change", refresh);
  }

  addRadios(
    "class-row",
    "class",
    meta.classes.map((c) => ({
      value: c.label,
      label: c.label,
      code: c.code ?? "",
    })),
    0,
    refresh
  );

  const tagRows = document.getElementById("tag-rows");
  for (const tag of meta.tags) {
    const row = document.createElement("div");
    row.className = "tag-row";
    row.innerHTML = `<span class="tag-label">${escapeHtml(tag.label)}</span>`;
    const states = document.createElement("div");
    states.className = "tag-states";
    for (const opt of ["무관", "포함", "없음"]) {
      const sid = `tag-${tag.code}-${opt}`;
      const checked = opt === "무관" ? "checked" : "";
      states.innerHTML += `<label class="inline"><input type="radio" name="tag-${tag.code}" id="${sid}" data-tag-code="${tag.code}" data-tag-state value="${opt}" ${checked} /> ${opt}</label>`;
    }
    row.appendChild(states);
    tagRows.appendChild(row);
    states.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", refresh);
    });
  }

  document.getElementById("god-all").addEventListener("click", () => {
    document.querySelectorAll('input[name="god"]').forEach((el) => {
      /** @type {HTMLInputElement} */ (el).checked = true;
    });
    refresh();
  });
  document.getElementById("god-none").addEventListener("click", () => {
    document.querySelectorAll('input[name="god"]').forEach((el) => {
      /** @type {HTMLInputElement} */ (el).checked = false;
    });
    refresh();
  });
  document.getElementById("reset-tags").addEventListener("click", () => {
    for (const tag of meta.tags) {
      const el = document.querySelector(`input[name="tag-${tag.code}"][value="무관"]`);
      if (el) /** @type {HTMLInputElement} */ (el).checked = true;
    }
    refresh();
  });
  document.getElementById("dedupe").addEventListener("change", refresh);
  document.getElementById("mode-help").addEventListener("click", () =>
    showHelp("런 모드", RUN_MODE_HELP)
  );
  document.getElementById("tag-help").addEventListener("click", () =>
    showHelp("태그 선택", TAG_STATE_HELP)
  );

  document.getElementById("clear-history").addEventListener("click", () => {
    searchHistory = [];
    compareAId = null;
    compareBId = null;
    historyComparePick.clear();
    saveSearchHistoryStore();
    renderHistoryPanel();
    renderComparePanel();
    updateCompareRunButton();
  });

  document.getElementById("clear-compare").addEventListener("click", () => {
    compareAId = null;
    compareBId = null;
    historyComparePick.clear();
    renderHistoryPanel();
    renderComparePanel();
    updateCompareRunButton();
  });

  document.getElementById("stage-current").addEventListener("click", addCurrentToStaging);
  document.getElementById("commit-staging").addEventListener("click", commitStagingToHistory);
  document.getElementById("clear-staging").addEventListener("click", clearStaging);
  document.getElementById("run-compare").addEventListener("click", runCompareFromSelection);
}

function buildGodLegend(meta) {
  const el = document.getElementById("god-legend");
  el.replaceChildren();
  for (const g of meta.gods) {
    const span = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.className = `god-${g.code.toLowerCase()}`;
    span.appendChild(swatch);
    span.appendChild(document.createTextNode(g.label));
    el.appendChild(span);
  }
  const note = document.createElement("span");
  note.className = "god-legend-note";
  note.textContent = "신 공통(묶음) = 배경색 없음";
  el.appendChild(note);
}

const LOOKUP_DATA_V = 3;

async function loadData() {
  const res = await fetch(`data/lookup.json?v=${LOOKUP_DATA_V}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  bundle = await res.json();
  godRank = new Map(bundle.meta.gods.map((g, i) => [g.label, i]));
  godLabelToCode = new Map(bundle.meta.gods.map((g) => [g.label, g.code]));
  visibleColumnKeys = loadVisibleColumns();
  columnWidths = loadColumnWidths();
  loadResultSort();
  buildColumnPicker();
  buildGodLegend(bundle.meta);
  buildResultTableHead();
  buildUI(bundle.meta);
  searchHistory = loadSearchHistory();
  renderStagingPanel();
  renderHistoryPanel();
  renderComparePanel();
  updateCompareRunButton();
  refresh();
}

loadData().catch((err) => {
  document.getElementById("result-body").innerHTML = `<tr><td colspan="8" class="empty">데이터 로드 실패: ${escapeHtml(err.message)}<br><br>GitHub Pages로 열거나, web 폴더에서 <code>python -m http.server</code> 후 접속하세요.</td></tr>`;
  document.getElementById("count-label").textContent = "오류";
});
