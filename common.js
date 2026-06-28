import { initCardSearch } from "./card-search.js";
import { initCardPicker } from "./card-picker.js";

const TAG_STATE_HELP =
  "태그 선택 안내\n" +
  "· 무관: 이 태그는 조건에 쓰지 않음\n" +
  "· 포함: 카드에 있음 → 이 태그 카드를 제외하는 번뜩임 제거\n" +
  "· 없음: 없음 → 이 태그를 요구하는 번뜩임 제거\n\n" +
  "소멸(exhaust): 카드 extra_tag와 TALENT_EXHAUST(소멸)를 동일하게 처리합니다.";

/** JSON에 misc_tags가 없을 때 사용 (구버전 common.json 호환) */
const FALLBACK_MISC_TAGS = [
  { code: "strength", label: "사기" },
  { code: "dexterity", label: "결의" },
  { code: "dmgresist", label: "피해 저항" },
  { code: "nine_exhaust", label: "9중 소진" },
  { code: "vulnerable", label: "취약" },
  { code: "weak", label: "약화" },
  { code: "mark", label: "표식" },
  { code: "pain", label: "고통" },
  { code: "counter", label: "카운터" },
  { code: "turncounter", label: "턴 카운터" },
  { code: "dmgdecrease", label: "피해 감소" },
  { code: "egodmg", label: "에고 피해" },
  { code: "ap", label: "행동 포인트" },
  { code: "ep", label: "에너지 포인트" },
  { code: "all_turncountadd", label: "턴 카운트+" },
];

/** ban_* 없을 때 conditions 문자열로 판별 */
const MISC_TAG_BAN_PHRASE = {
  strength: "사기 태그 카드 제외",
  dexterity: "결의 태그 카드 제외",
  dmgresist: "피해 저항 태그 카드 제외",
  nine_exhaust: "9중 소진 태그 카드 제외",
  vulnerable: "취약 태그 카드 제외",
  weak: "약화 태그 카드 제외",
  mark: "표식 태그 카드 제외",
  pain: "고통 태그 카드 제외",
  counter: "카운터 태그 카드 제외",
  turncounter: "턴 카운터 태그 카드 제외",
  dmgdecrease: "피해 감소 태그 카드 제외",
  egodmg: "에고 피해 태그 카드 제외",
  ap: "행동 포인트 태그 카드 제외",
  ep: "에너지 포인트 태그 카드 제외",
};

const RESULT_COLUMNS = [
  { key: "description", label: "설명", mono: false, sortable: true },
  { key: "conditions", label: "조건", mono: false, sortable: false },
  { key: "weight", label: "가중치", mono: false, sortable: true },
  { key: "probability", label: "확률", mono: false, sortable: true },
  { key: "id", label: "ID", mono: true, sortable: true },
];

const COLUMN_WIDTHS = {
  description: 280,
  conditions: 320,
  weight: 72,
  probability: 56,
  id: 160,
};

/** @type {{ meta: object, entries: object[] } | null} */
let bundle = null;

/** @type {{ key: string|null, dir: "asc"|"desc" }} */
let resultSort = { key: "weight", dir: "desc" };

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function entryWeightNum(weight) {
  if (typeof weight === "number") return weight;
  const s = String(weight ?? "");
  const range = s.match(/^(\d+)~(\d+)$/);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatProb(p) {
  return p > 0 ? `${(p * 100).toFixed(1)}%` : "—";
}

function sparkMatchesCost(min, max, cardCost) {
  return min <= cardCost && cardCost <= max;
}

function effectKeyStr(entry) {
  return JSON.stringify(entry.effect_key ?? []);
}

function attachPoolProbabilities(entries) {
  const total = entries.reduce((s, e) => s + entryWeightNum(e.weight), 0);
  for (const e of entries) {
    const w = entryWeightNum(e.weight);
    e._prob = total > 0 && w > 0 ? w / total : 0;
    e.probability = formatProb(e._prob);
  }
}

function probNum(entry) {
  return entry._prob != null ? entry._prob : 0;
}

function mergeVariants(members) {
  const first = members[0];
  const ids = [...new Set(members.map((e) => e.id))].sort();
  const weights = members.map((e) => e.weight);
  const uniqW = new Set(weights);
  const weight =
    uniqW.size === 1 ? weights[0] : `${Math.min(...weights.map(entryWeightNum))}~${Math.max(...weights.map(entryWeightNum))}`;
  const descs = [...new Set(members.map((e) => e.description))];
  const description = descs.length === 1 ? descs[0] : descs.join(" / ");
  const prob = members.reduce((s, e) => s + probNum(e), 0);
  return {
    ...first,
    id: ids.join(", "),
    description,
    conditions: first.conditions ?? "",
    weight,
    _prob: prob,
    probability: formatProb(prob),
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
    const key = effectKeyStr(e);
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
    merged.push({ ...mergeVariants(members), _prob: p, probability: formatProb(p) });
  }
  return merged;
}

function compareDefault(a, b) {
  const wa = entryWeightNum(a.weight);
  const wb = entryWeightNum(b.weight);
  if (wa !== wb) return wb - wa;
  return String(a.description ?? "").localeCompare(String(b.description ?? ""), "ko");
}

function sortMatched(entries, sort) {
  if (!sort.key) {
    return [...entries].sort(compareDefault);
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
      case "description":
        cmp = String(a.description ?? "").localeCompare(String(b.description ?? ""), "ko");
        break;
      case "id":
        cmp = String(a.id).localeCompare(String(b.id));
        break;
      default:
        break;
    }
    if (cmp !== 0) return cmp * dir;
    return compareDefault(a, b);
  });
}

function cycleResultSort(key) {
  if (resultSort.key === key) {
    if (resultSort.dir === "desc") resultSort.dir = "asc";
    else {
      resultSort.key = "weight";
      resultSort.dir = "desc";
    }
  } else {
    resultSort.key = key;
    resultSort.dir = "desc";
  }
  buildResultTableHead();
  refresh();
}

function getFilters() {
  const showAll = /** @type {HTMLInputElement} */ (document.getElementById("show-all")).checked;
  const cost = Number(document.querySelector('input[name="cost"]:checked')?.value ?? "2");
  const typeCode = document.querySelector('input[name="type"]:checked')?.dataset.code ?? "";
  const classCode =
    document.querySelector('input[name="class"]:checked')?.dataset.code ?? "";
  const dedupe = /** @type {HTMLInputElement} */ (document.getElementById("dedupe")).checked;
  const text = /** @type {HTMLInputElement} */ (document.getElementById("text-filter")).value
    .trim()
    .toLowerCase();

  /** @type {Record<string, string>} */
  const tagStates = {};
  if (bundle) {
    for (const tag of bundle.meta.tags) {
      const checked = document.querySelector(`input[name="tag-${tag.code}"]:checked`);
      if (checked) tagStates[tag.code] = /** @type {HTMLInputElement} */ (checked).value;
    }
  }

  /** @type {Set<string>} */
  const miscTagsOnCard = new Set();
  for (const tag of resolveMiscTags(bundle?.meta)) {
    const el = /** @type {HTMLInputElement} */ (
      document.getElementById(`misc-tag-${tag.code}`)
    );
    if (el?.checked) miscTagsOnCard.add(tag.code);
  }

  return { showAll, cost, typeCode, classCode, dedupe, tagStates, miscTagsOnCard, text };
}

function applyFilters(filters) {
  const showAllEl = /** @type {HTMLInputElement} */ (document.getElementById("show-all"));
  if (showAllEl) showAllEl.checked = !!filters.showAll;

  const costEl = document.querySelector(`input[name="cost"][value="${filters.cost}"]`);
  if (costEl) /** @type {HTMLInputElement} */ (costEl).checked = true;

  for (const el of document.querySelectorAll('input[name="type"]')) {
    const input = /** @type {HTMLInputElement} */ (el);
    input.checked = input.dataset.code === (filters.typeCode ?? "");
  }

  for (const el of document.querySelectorAll('input[name="class"]')) {
    const input = /** @type {HTMLInputElement} */ (el);
    input.checked = input.dataset.code === (filters.classCode ?? "");
  }

  if (bundle) {
    for (const tag of bundle.meta.tags) {
      const state = filters.tagStates?.[tag.code] ?? "무관";
      const el = document.querySelector(`input[name="tag-${tag.code}"][value="${state}"]`);
      if (el) /** @type {HTMLInputElement} */ (el).checked = true;
    }
  }

  const miscSet = new Set(filters.miscTagsOnCard ?? filters.miscTags ?? []);
  for (const tag of resolveMiscTags(bundle?.meta)) {
    const el = /** @type {HTMLInputElement} */ (
      document.getElementById(`misc-tag-${tag.code}`)
    );
    if (el) el.checked = miscSet.has(tag.code);
  }

  const textEl = /** @type {HTMLInputElement} */ (document.getElementById("text-filter"));
  if (textEl && filters.text !== undefined) textEl.value = filters.text;
}

function applyCardFilterPatch(patch) {
  const current = getFilters();
  applyFilters({
    ...current,
    showAll: false,
    cost: patch.cost,
    typeCode: patch.typeCode,
    classCode: patch.classCode,
    tagStates: patch.tagStates,
    miscTagsOnCard: new Set(patch.miscTags ?? []),
  });
  refresh();
}

function resolveMiscTags(meta) {
  const fromMeta = meta?.misc_tags;
  if (Array.isArray(fromMeta) && fromMeta.length) return fromMeta;
  return FALLBACK_MISC_TAGS;
}

/** 번뜩임이 이 태그를 가진 카드를 제외하는지 */
function entryBansTag(entry, code) {
  if (Number(entry[`ban_${code}`]) === 1) return true;
  const phrase = MISC_TAG_BAN_PHRASE[code];
  const cond = String(entry.conditions ?? "");
  return !!(phrase && cond.includes(phrase));
}

function passesMiscTagFilter(entry, miscTagsOnCard) {
  for (const code of miscTagsOnCard) {
    if (entryBansTag(entry, code)) return false;
  }
  return true;
}

function matchCardFilters(e, f) {
  if (!sparkMatchesCost(e.cost_min, e.cost_max, f.cost)) return false;

  if (f.typeCode === "CARD_ATK" && !e.ok_atk) return false;
  if (f.typeCode === "CARD_SKILL" && !e.ok_skill) return false;
  if (f.typeCode === "CARD_POWER" && !e.ok_power) return false;

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

  if (f.text) {
    const hay = `${e.description}\n${e.id}\n${e.conditions}`.toLowerCase();
    if (!hay.includes(f.text)) return false;
  }
  return true;
}

function matchEntry(e, f) {
  if (!matchCardFilters(e, f)) return false;
  return passesMiscTagFilter(e, f.miscTagsOnCard);
}

function computeMatched(filters) {
  if (!bundle) return [];
  let raw = bundle.entries;
  if (!filters.showAll) {
    raw = raw.filter((e) => matchEntry(e, filters));
  } else {
    raw = raw.filter(
      (e) =>
        passesMiscTagFilter(e, filters.miscTagsOnCard) &&
        (!filters.text ||
          `${e.description}\n${e.id}\n${e.conditions}`
            .toLowerCase()
            .includes(filters.text))
    );
  }

  const rawProbs = new Map();
  const total = raw.reduce((s, e) => s + entryWeightNum(e.weight), 0);
  for (const e of raw) {
    const w = entryWeightNum(e.weight);
    rawProbs.set(e.id, total > 0 && w > 0 ? w / total : 0);
  }

  let matched = applyDedupe(raw, filters.dedupe, rawProbs);
  matched = sortMatched(matched, resultSort);
  return matched;
}

function rowCellValue(entry, key) {
  const v = entry[key];
  if (v === undefined || v === null) return "";
  return String(v);
}

function buildResultTableHead() {
  const table = document.querySelector(".results table");
  const colgroup = document.getElementById("result-cols");
  const thead = document.querySelector(".results table thead tr");
  colgroup.replaceChildren();
  thead.replaceChildren();

  for (const col of RESULT_COLUMNS) {
    const width = COLUMN_WIDTHS[col.key] ?? 100;
    const colEl = document.createElement("col");
    colEl.dataset.col = col.key;
    colEl.style.width = `${width}px`;
    colgroup.appendChild(colEl);

    const th = document.createElement("th");
    th.className = "col-header";
    th.dataset.col = col.key;
    th.style.width = `${width}px`;
    const label = document.createElement("span");
    label.className = "col-label";
    label.textContent = col.label;
    if (col.sortable) {
      th.classList.add("col-sortable");
      if (resultSort.key === col.key) {
        th.classList.add(resultSort.dir === "asc" ? "col-sorted-asc" : "col-sorted-desc");
      }
      label.title = "클릭하여 정렬";
      label.addEventListener("click", (ev) => {
        ev.stopPropagation();
        cycleResultSort(col.key);
      });
    }
    th.appendChild(label);
    thead.appendChild(th);
  }

  const total = RESULT_COLUMNS.reduce((s, c) => s + (COLUMN_WIDTHS[c.key] ?? 100), 0);
  table.style.width = `${total}px`;
}

function appendResultRow(tbody, entry) {
  const tr = document.createElement("tr");
  tr.className = "row-common-spark";
  for (const col of RESULT_COLUMNS) {
    const td = document.createElement("td");
    if (col.mono) td.className = "mono";
    td.dataset.col = col.key;
    td.textContent = rowCellValue(entry, col.key);
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
}

function refresh() {
  if (!bundle) return;
  const matched = computeMatched(getFilters());
  const tbody = document.getElementById("result-body");
  tbody.replaceChildren();
  if (!matched.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = RESULT_COLUMNS.length;
    td.className = "empty";
    td.textContent = "조건에 맞는 일반 번뜩임 없음";
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const e of matched) appendResultRow(tbody, e);
  }
  const f = getFilters();
  const label = f.showAll ? "전체" : "조건 일치";
  document.getElementById("count-label").textContent = `${label} ${matched.length}건 / 총 ${bundle.entry_count}건`;
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
    label.querySelector("input").addEventListener("change", onChange);
  });
}

function buildMiscTagRows(meta) {
  const container = document.getElementById("misc-tag-rows");
  if (!container) return;
  container.replaceChildren();
  const tags = resolveMiscTags(meta);
  for (const tag of tags) {
    const id = `misc-tag-${tag.code}`;
    const label = document.createElement("label");
    label.className = "inline misc-tag-item";
    label.title = tag.code;
    const text = tag.label.includes("(") ? tag.label : tag.label;
    label.innerHTML = `<input type="checkbox" id="${id}" data-misc-code="${escapeHtml(tag.code)}" /> ${escapeHtml(text)}`;
    container.appendChild(label);
    label.querySelector("input").addEventListener("change", refresh);
  }
}

function buildTagRows(meta) {
  const container = document.getElementById("tag-rows");
  container.replaceChildren();
  for (const tag of meta.tags) {
    const row = document.createElement("fieldset");
    row.className = "tag-field";
    row.id = `tag-${tag.code}`;
    row.dataset.tagCode = tag.code;
    row.innerHTML = `<legend>${escapeHtml(tag.label)}</legend>`;
    const states = ["무관", "포함", "없음"];
    const inner = document.createElement("div");
    inner.className = "radio-row";
    states.forEach((state, i) => {
      const id = `tag-${tag.code}-${i}`;
      const label = document.createElement("label");
      label.className = "inline";
      label.innerHTML = `<input type="radio" name="tag-${tag.code}" id="${id}" value="${state}" ${i === 0 ? "checked" : ""} /> ${state}`;
      inner.appendChild(label);
    });
    row.appendChild(inner);
    container.appendChild(row);
    inner.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", refresh);
    });
  }
}

function buildUI(meta) {
  addRadios(
    "cost-row",
    "cost",
    ["0", "1", "2", "3", "4"].map((v) => ({ value: v, label: v, code: v })),
    2,
    refresh
  );
  addRadios("type-row", "type", meta.card_types.map((t) => ({
    value: t.label,
    label: t.label,
    code: t.code ?? "",
  })), 2, refresh);
  addRadios("class-row", "class", meta.classes.map((c) => ({
    value: c.label,
    label: c.label,
    code: c.code ?? "",
  })), 0, refresh);
  buildTagRows(meta);
  buildMiscTagRows(meta);

  document.getElementById("tag-help").addEventListener("click", () => {
    document.getElementById("help-title").textContent = "태그 선택";
    document.getElementById("help-body").textContent = TAG_STATE_HELP;
    /** @type {HTMLDialogElement} */ (document.getElementById("help-dialog")).showModal();
  });
  document.getElementById("reset-tags").addEventListener("click", () => {
    for (const el of document.querySelectorAll('[id^="tag-"][data-tag-code] input[value="무관"]')) {
      /** @type {HTMLInputElement} */ (el).checked = true;
    }
    for (const el of document.querySelectorAll("#misc-tag-rows input[type=checkbox]")) {
      /** @type {HTMLInputElement} */ (el).checked = false;
    }
    refresh();
  });
  document.getElementById("dedupe").addEventListener("change", refresh);
  document.getElementById("show-all").addEventListener("change", refresh);
  document.getElementById("text-filter").addEventListener("input", refresh);
}

const COMMON_DATA_V = 3;

async function loadData() {
  const res = await fetch(`data/common.json?v=${COMMON_DATA_V}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  bundle = await res.json();
  buildResultTableHead();
  buildUI(bundle.meta);
  const cardPickerApi = await initCardPicker({
    openButtonId: "card-picker-open",
    getMeta: () => bundle?.meta ?? null,
    helpers: { resolveMiscTags },
    onApply: (patch) => applyCardFilterPatch(patch),
  });
  initCardSearch({
    inputId: "card-search-input",
    listId: "card-search-list",
    statusId: "card-search-status",
    getMeta: () => bundle?.meta ?? null,
    helpers: { resolveMiscTags },
    onApply: (patch) => applyCardFilterPatch(patch),
    onCardPicked: (card) => cardPickerApi?.openSparkPickerForCard(card.id),
  });
  refresh();
}

loadData().catch((err) => {
  showLoadError(err?.message ?? String(err));
});

function showLoadError(message) {
  const tbody = document.getElementById("result-body");
  const count = document.getElementById("count-label");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">데이터 로드 실패: ${escapeHtml(message)}<br><br>web 폴더에서 <code>python -m http.server</code> 후 접속하거나, <code>python export_web_data.py</code>로 JSON을 생성하세요.</td></tr>`;
  }
  if (count) count.textContent = "오류";
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (ev) => {
    if (bundle) return;
    const msg = ev.message || "스크립트 오류";
    if (msg.includes("already been declared")) {
      showLoadError("common.js 구문 오류 — 페이지를 강력 새로고침(Ctrl+F5)하세요.");
    }
  });
}
