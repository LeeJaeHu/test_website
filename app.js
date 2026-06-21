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
  { key: "mode", label: "모드", mono: false },
  { key: "god", label: "신", mono: false },
  { key: "id", label: "ID", mono: true },
];

const COLUMN_DEFAULT_WIDTH_PX = {
  sheet: 96,
  description: 240,
  conditions: 300,
  weight: 72,
  mode: 64,
  god: 100,
  id: 180,
};

const VISIBLE_COLS_KEY = "spark-lookup-visible-cols";
const COLUMN_WIDTHS_KEY = "spark-lookup-col-widths";

/** @type {Set<string>} */
let visibleColumnKeys = new Set();

/** @type {Record<string, number>} */
let columnWidths = {};

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

function sparkMatchesCost(min, max, cardCost) {
  if (min <= cardCost && cardCost <= max) return true;
  if (min === -1 && max === 0 && cardCost >= 0) return true;
  return false;
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

function applyDedupe(matched, dedupe) {
  if (!dedupe) return matched;
  /** @type {Map<string, object[]>} */
  const buckets = new Map();
  for (const e of matched) {
    const key = `${effectKeyStr(e)}\0${e.mode}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  }
  const merged = [];
  for (const members of buckets.values()) {
    if (members.length === 1) {
      merged.push(members[0]);
      continue;
    }
    const uniqueGods = new Set(members.map((e) => e.god));
    merged.push(
      uniqueGods.size >= 2 ? mergeGodClones(members) : mergeSameGodVariants(members)
    );
  }
  return merged;
}

function getFilters() {
  const cost = Number(document.querySelector('input[name="cost"]:checked')?.value ?? "2");
  const typeCode = document.querySelector('input[name="type"]:checked')?.dataset.code ?? "";
  const mode = document.querySelector('input[name="mode"]:checked')?.value ?? "기본";
  const classCode =
    document.querySelector('input[name="class"]:checked')?.dataset.code ?? "";
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

  return { cost, typeCode, mode, classCode, gods, tagStates, dedupe };
}

function matchEntry(e, f) {
  if (!sparkMatchesCost(e.cost_min, e.cost_max, f.cost)) return false;

  if (f.typeCode === "CARD_ATK" && !e.ok_atk) return false;
  if (f.typeCode === "CARD_SKILL" && !e.ok_skill) return false;
  if (f.typeCode === "CARD_POWER" && !e.ok_power) return false;

  if (f.mode === "기본" && e.mode !== "기본") return false;
  if (f.mode === "출격" && e.mode !== "출격") return false;

  if (!f.gods.size) return false;
  const godOrder = bundle.meta.god_order;
  if (f.gods.size < godOrder.length && !f.gods.has(e.god_code)) return false;

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
    visibleColumnKeys = new Set(["description", "conditions", "weight"]);
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
  let matched = bundle.entries.filter((e) => matchEntry(e, f));
  matched = applyDedupe(matched, f.dedupe);
  const commonRows = matched.filter((e) => isCommonSheet(e.sheet));
  const godRows = matched.filter((e) => !isCommonSheet(e.sheet));
  commonRows.sort(compareBySheetThenWeight);
  godRows.sort(compareBySheetThenWeight);
  matched = [...commonRows, ...godRows];

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

const LOOKUP_DATA_V = 2;

async function loadData() {
  const res = await fetch(`data/lookup.json?v=${LOOKUP_DATA_V}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  bundle = await res.json();
  godRank = new Map(bundle.meta.gods.map((g, i) => [g.label, i]));
  godLabelToCode = new Map(bundle.meta.gods.map((g) => [g.label, g.code]));
  visibleColumnKeys = loadVisibleColumns();
  columnWidths = loadColumnWidths();
  buildColumnPicker();
  buildGodLegend(bundle.meta);
  buildResultTableHead();
  buildUI(bundle.meta);
  refresh();
}

loadData().catch((err) => {
  document.getElementById("result-body").innerHTML = `<tr><td colspan="7" class="empty">데이터 로드 실패: ${escapeHtml(err.message)}<br><br>GitHub Pages로 열거나, web 폴더에서 <code>python -m http.server</code> 후 접속하세요.</td></tr>`;
  document.getElementById("count-label").textContent = "오류";
});
