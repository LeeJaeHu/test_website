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

/** @type {{ meta: object, entries: object[] } | null} */
let bundle = null;

/** @type {Map<string, number>} */
let godRank = new Map();

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
  return {
    id: ids.join(", "),
    sheet: `${first.mode}-신공통`,
    mode: first.mode,
    god: gods.join(" · "),
    description: first.description,
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
    description,
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

function refresh() {
  if (!bundle) return;
  const f = getFilters();
  let matched = bundle.entries.filter((e) => matchEntry(e, f));
  matched = applyDedupe(matched, f.dedupe);
  matched.sort((a, b) => {
    const [ra, ga] = godSortKey(a.god);
    const [rb, gb] = godSortKey(b.god);
    if (ra !== rb) return ra - rb;
    const wa = typeof a.weight === "number" ? a.weight : 0;
    const wb = typeof b.weight === "number" ? b.weight : 0;
    if (wa !== wb) return wb - wa;
    return String(a.id).localeCompare(String(b.id));
  });

  const tbody = document.getElementById("result-body");
  tbody.replaceChildren();
  if (!matched.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="6" class="empty">조건에 맞는 번뜩임 없음</td>';
    tbody.appendChild(tr);
  } else {
    for (const e of matched) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="mono">${escapeHtml(e.id)}</td>
        <td>${escapeHtml(e.sheet)}</td>
        <td>${escapeHtml(e.mode)}</td>
        <td>${escapeHtml(e.god)}</td>
        <td>${escapeHtml(e.description)}</td>
        <td>${escapeHtml(String(e.weight))}</td>`;
      tbody.appendChild(tr);
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

async function loadData() {
  const res = await fetch("data/lookup.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  bundle = await res.json();
  godRank = new Map(bundle.meta.gods.map((g, i) => [g.label, i]));
  buildUI(bundle.meta);
  refresh();
}

loadData().catch((err) => {
  document.getElementById("result-body").innerHTML = `<tr><td colspan="6" class="empty">데이터 로드 실패: ${escapeHtml(err.message)}<br><br>GitHub Pages로 열거나, web 폴더에서 <code>python -m http.server</code> 후 접속하세요.</td></tr>`;
  document.getElementById("count-label").textContent = "오류";
});
