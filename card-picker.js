import { cardToFilterPatch, CARDS_DATA_V } from "./card-search.js";

/** @typedef {{ id: number, name: string, portrait: string, card_count: number }} Combatant */
/** @typedef {{ id: string, result_id: string, kind: string, label?: string, summary?: string, name?: string }} UniqueSpark */
/** @typedef {{ id: string, name: string, cost: number, filter_cost: number, type: string, class: string|null, tags: string[], exhaust?: boolean, combatant_id?: number|null, sct_name?: string, unique?: UniqueSpark[], commons?: string[], is_spark_result?: boolean }} PickerCard */
/** @typedef {{ id: string, description: string, cost_delta: number, weight?: number }} CommonSpark */

let bundle = null;
/** @type {Map<string, PickerCard>} */
let cardsById = new Map();
/** @type {Record<string, CommonSpark>} */
let commonSparks = {};

/** @type {object|null} */
let pickerCtx = null;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function typeShort(typeCode) {
  if (typeCode === "CARD_ATK") return "공격";
  if (typeCode === "CARD_SKILL") return "스킬";
  if (typeCode === "CARD_POWER") return "강화";
  return typeCode;
}

function cardTypeClass(typeCode) {
  if (typeCode === "CARD_ATK") return "card-tile-atk";
  if (typeCode === "CARD_SKILL") return "card-tile-skill";
  if (typeCode === "CARD_POWER") return "card-tile-power";
  return "card-tile-neutral";
}

function formatTagList(card) {
  const parts = [];
  if (card.tags?.length) {
    parts.push(...card.tags.map((t) => TAG_LABELS[t] ?? t));
  }
  if (card.talents?.length) {
    parts.push(...card.talents);
  }
  if (card.exhaust && !card.tags?.includes("exhaust")) {
    parts.push("소멸");
  }
  return parts.length ? parts.join(", ") : "태그 없음";
}

const TAG_LABELS = {
  targetable: "대상지정",
  shield: "보호막",
  cure: "치유",
  draw: "드로우",
  exhaust: "소멸",
  strength: "사기",
  dexterity: "결의",
  dmgresist: "피해 저항",
  nine_exhaust: "9중 소진",
  vulnerable: "취약",
  weak: "약화",
  mark: "표식",
  pain: "고통",
  counter: "카운터",
  turncounter: "턴 카운터",
  dmgdecrease: "피해 감소",
  egodmg: "에고 피해",
  ap: "행동 PT",
  ep: "에너지 PT",
};

function cardTileHtml(card, { compact = false, headline, subline } = {}) {
  const cost = card.filter_cost ?? card.cost;
  const cls = cardTypeClass(card.type);
  const title = headline ?? card.name;
  const sub =
    subline ??
    (compact
      ? `${cost}코 · ${typeShort(card.type)}`
      : `${cost}코 · ${typeShort(card.type)} · ${formatTagList(card)}`);
  return `<article class="picker-card-tile ${cls}" data-card-id="${escapeHtml(card.id)}" title="${escapeHtml(card.name)}">
    <div class="picker-card-art" aria-hidden="true"><span class="picker-card-cost">${cost}</span></div>
    <div class="picker-card-caption">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(sub)}</span>
    </div>
  </article>`;
}

function cardTileButtonHtml(card, { headline, subline, selected = false, extraClass = "" }) {
  const cost = card.filter_cost ?? card.cost;
  const cls = cardTypeClass(card.type);
  const title = headline ?? card.name;
  const sub = subline ?? `${cost}코 · ${typeShort(card.type)} · ${formatTagList(card)}`;
  return `<button type="button" class="picker-card-tile picker-card-tile-btn ${cls} ${extraClass}${selected ? " is-selected" : ""}" title="${escapeHtml(sub)}">
    <div class="picker-card-art" aria-hidden="true"><span class="picker-card-cost">${cost}</span></div>
    <div class="picker-card-caption">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(sub)}</span>
    </div>
  </button>`;
}

export async function loadCardsBundle() {
  if (bundle) return bundle;
  const res = await fetch(`data/cards.json?v=${CARDS_DATA_V}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  bundle = await res.json();
  cardsById = new Map((bundle.cards ?? []).map((c) => [c.id, c]));
  commonSparks = bundle.common_sparks ?? {};
  return bundle;
}

/**
 * @param {PickerCard} baseCard
 * @param {UniqueSpark|null} uniqueSpark
 * @param {string|null} commonSparkId
 */
export function resolveCardFilterPatch(baseCard, uniqueSpark, commonSparkId, meta, helpers) {
  let card = baseCard;
  if (uniqueSpark?.result_id) {
    card = cardsById.get(uniqueSpark.result_id) ?? baseCard;
  }
  const patch = cardToFilterPatch(card, meta, helpers);
  if (commonSparkId && commonSparks[commonSparkId]) {
    const delta = commonSparks[commonSparkId].cost_delta ?? 0;
    const raw = card.cost + delta;
    patch.cost = Math.max(0, Math.min(4, raw));
  }
  return { patch, card, baseCard, uniqueSpark, commonSparkId };
}

function buildStatusLabel(result) {
  const parts = [result.card.name];
  if (result.uniqueSpark) {
    parts.push(`고유: ${result.uniqueSpark.label || result.uniqueSpark.summary || result.uniqueSpark.id}`);
  }
  if (result.commonSparkId && commonSparks[result.commonSparkId]) {
    const cs = commonSparks[result.commonSparkId];
    parts.push(`일반: ${cs.description.slice(0, 24)}`);
  }
  parts.push(`${result.patch.cost}코`);
  return parts.join(" · ");
}

function pickerCardsForCombatant(combatantId) {
  const list = (bundle?.cards ?? []).filter((c) => {
    if (c.is_spark_result) return false;
    if (combatantId === null) {
      return !c.combatant_id || pickerCtx?.sharedSources?.has(c.source);
    }
    return c.combatant_id === combatantId;
  });
  list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return list;
}

function renderCharacterStep(body) {
  body.replaceChildren();
  const grid = document.createElement("div");
  grid.className = "picker-grid picker-char-grid";

  const sharedBtn = document.createElement("button");
  sharedBtn.type = "button";
  sharedBtn.className = "picker-char-tile picker-char-shared";
  sharedBtn.innerHTML = `<span class="picker-char-art" aria-hidden="true">공</span><strong>공용</strong><span>${bundle?.shared_card_count ?? 0}장</span>`;
  sharedBtn.addEventListener("click", () => showCardStep(null));
  grid.appendChild(sharedBtn);

  for (const ch of bundle?.combatants ?? []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-char-tile";
    btn.dataset.combatantId = String(ch.id);
    const img = document.createElement("img");
    img.className = "picker-char-portrait";
    img.alt = "";
    img.loading = "lazy";
    img.src = ch.portrait;
    img.onerror = () => {
      img.remove();
      const ph = document.createElement("span");
      ph.className = "picker-char-art";
      ph.textContent = ch.name.slice(0, 1);
      btn.prepend(ph);
    };
    btn.append(img);
    const cap = document.createElement("div");
    cap.className = "picker-char-caption";
    cap.innerHTML = `<strong>${escapeHtml(ch.name)}</strong><span>${ch.card_count}장</span>`;
    btn.appendChild(cap);
    btn.addEventListener("click", () => showCardStep(ch.id));
    grid.appendChild(btn);
  }

  body.appendChild(grid);
  setPickerTitle("캐릭터 선택");
  setPickerBack(null);
}

function showCardStep(combatantId) {
  const body = document.getElementById("card-picker-body");
  if (!body) return;
  body.replaceChildren();

  const cards = pickerCardsForCombatant(combatantId);
  const grid = document.createElement("div");
  grid.className = "picker-grid picker-card-grid";
  if (!cards.length) {
    grid.innerHTML = `<p class="hint">표시할 카드가 없습니다.</p>`;
  } else {
    for (const card of cards) {
      const wrap = document.createElement("div");
      wrap.innerHTML = cardTileHtml(card);
      wrap.firstElementChild.addEventListener("click", () => showSparkStep(card));
      grid.appendChild(wrap.firstElementChild);
    }
  }
  body.appendChild(grid);

  const label =
    combatantId === null
      ? "공용 카드"
      : bundle?.combatants?.find((c) => c.id === combatantId)?.name ?? String(combatantId);
  setPickerTitle(`${label} — 카드 선택`);
  setPickerBack(() => renderCharacterStep(body));
  pickerCtx.currentCombatant = combatantId;
}

function showSparkStep(baseCard) {
  const body = document.getElementById("card-picker-body");
  if (!body) return;
  body.replaceChildren();
  pickerCtx.selectedBase = baseCard;
  pickerCtx.selectedUnique = null;
  pickerCtx.selectedCommon = null;

  const preview = document.createElement("div");
  preview.className = "picker-spark-preview";
  preview.innerHTML = cardTileHtml(baseCard, {
    compact: true,
    subline: `${baseCard.filter_cost ?? baseCard.cost}코 · ${typeShort(baseCard.type)} · ${formatTagList(baseCard)}`,
  });
  body.appendChild(preview);

  const uniqueSection = document.createElement("section");
  uniqueSection.className = "picker-spark-section";
  uniqueSection.innerHTML = `<h4>고유 번뜩임</h4><p class="hint">색·코스트·태그로 변화를 확인하세요. 이름이 없는 변형은 요약으로 표시됩니다.</p>`;
  const uniqueGrid = document.createElement("div");
  uniqueGrid.className = "picker-grid picker-card-grid picker-spark-card-grid";

  uniqueGrid.appendChild(
    (() => {
      const el = document.createElement("div");
      el.innerHTML = cardTileButtonHtml(baseCard, {
        headline: "원본",
        subline: `${baseCard.filter_cost ?? baseCard.cost}코 · ${typeShort(baseCard.type)} · ${formatTagList(baseCard)}`,
        selected: true,
        extraClass: "spark-tile-base",
      });
      const btn = el.firstElementChild;
      btn.dataset.sparkId = "__base__";
      btn.addEventListener("click", () => selectUnique(null, uniqueGrid));
      return btn;
    })()
  );

  for (const u of baseCard.unique ?? []) {
    const result = cardsById.get(u.result_id) ?? baseCard;
    const el = document.createElement("div");
    el.innerHTML = cardTileButtonHtml(result, {
      headline: u.label || "고유",
      subline: u.summary || formatTagList(result),
      extraClass: "spark-tile-unique",
    });
    const btn = el.firstElementChild;
    btn.dataset.sparkId = u.id;
    btn.addEventListener("click", () => selectUnique(u, uniqueGrid));
    uniqueGrid.appendChild(btn);
  }
  uniqueSection.appendChild(uniqueGrid);
  body.appendChild(uniqueSection);

  const commonSection = document.createElement("section");
  commonSection.className = "picker-spark-section";
  commonSection.innerHTML = `<h4>일반 번뜩임</h4><p class="hint">이 카드에 부여 가능한 일반 번뜩임 (${(baseCard.commons ?? []).length}종)</p>`;
  const commonGrid = document.createElement("div");
  commonGrid.className = "picker-spark-list";

  const noneBtn = document.createElement("button");
  noneBtn.type = "button";
  noneBtn.className = "picker-common-item is-selected";
  noneBtn.dataset.sparkId = "__none__";
  noneBtn.innerHTML = `<strong>없음</strong><span>일반 번뜩임 적용 안 함</span>`;
  noneBtn.addEventListener("click", () => selectCommon(null, commonGrid));
  commonGrid.appendChild(noneBtn);

  for (const sid of baseCard.commons ?? []) {
    const cs = commonSparks[sid];
    if (!cs) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-common-item";
    btn.dataset.sparkId = sid;
    const delta =
      cs.cost_delta < 0
        ? `코스트 ${cs.cost_delta}`
        : cs.cost_delta > 0
          ? `코스트 +${cs.cost_delta}`
          : "";
    btn.innerHTML = `<strong>${escapeHtml(cs.description || sid)}</strong><span>${escapeHtml([delta, sid].filter(Boolean).join(" · "))}</span>`;
    btn.addEventListener("click", () => selectCommon(sid, commonGrid));
    commonGrid.appendChild(btn);
  }
  commonSection.appendChild(commonGrid);
  body.appendChild(commonSection);

  const actions = document.createElement("div");
  actions.className = "picker-spark-actions";
  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "primary-btn";
  applyBtn.textContent = "조건 적용";
  applyBtn.addEventListener("click", () => applySparkSelection());
  actions.appendChild(applyBtn);
  body.appendChild(actions);

  setPickerTitle(`${baseCard.name} — 카드 번뜩임`);
  setPickerBack(() => showCardStep(pickerCtx.currentCombatant));
}

function selectUnique(unique, grid) {
  pickerCtx.selectedUnique = unique;
  grid.querySelectorAll(".picker-card-tile-btn").forEach((el) => {
    const sid = el.dataset.sparkId;
    el.classList.toggle("is-selected", unique ? sid === unique.id : sid === "__base__");
  });
}

function selectCommon(commonId, grid) {
  pickerCtx.selectedCommon = commonId;
  grid.querySelectorAll(".picker-common-item").forEach((el) => {
    const sid = el.dataset.sparkId;
    el.classList.toggle("is-selected", commonId ? sid === commonId : sid === "__none__");
  });
}

function applySparkSelection() {
  const base = pickerCtx.selectedBase;
  if (!base || !pickerCtx.getMeta) return;
  const meta = pickerCtx.getMeta();
  if (!meta) return;
  const result = resolveCardFilterPatch(
    base,
    pickerCtx.selectedUnique,
    pickerCtx.selectedCommon,
    meta,
    pickerCtx.helpers
  );
  pickerCtx.onApply(result.patch, result);
  const status = document.getElementById("card-search-status");
  if (status) status.textContent = `적용: ${buildStatusLabel(result)}`;
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById("card-search-input"));
  if (input) input.value = result.card.name;
  closePickerDialog();
}

function setPickerTitle(text) {
  const el = document.getElementById("card-picker-title");
  if (el) el.textContent = text;
}

function setPickerBack(handler) {
  pickerCtx.backHandler = handler;
  const back = document.getElementById("card-picker-back");
  if (back) back.hidden = !handler;
}

function closePickerDialog() {
  const dlg = /** @type {HTMLDialogElement|null} */ (document.getElementById("card-picker-dialog"));
  if (dlg?.open) dlg.close();
}

export function openSparkPickerForCard(cardId, ctx) {
  pickerCtx = {
    ...ctx,
    sharedSources: new Set(["public", "etc", "encounter", "disaster", "monster", "partner", "eidolon", "assault"]),
    currentCombatant: null,
    selectedBase: null,
    selectedUnique: null,
    selectedCommon: null,
    backHandler: null,
  };
  let card = cardsById.get(cardId);
  if (!card) return;
  if (card.is_spark_result) {
    for (const c of bundle?.cards ?? []) {
      const hit = (c.unique ?? []).find((u) => u.result_id === cardId);
      if (hit) {
        card = c;
        break;
      }
    }
  }
  const body = document.getElementById("card-picker-body");
  const dlg = /** @type {HTMLDialogElement|null} */ (document.getElementById("card-picker-dialog"));
  if (!body || !dlg) return;
  showSparkStep(card);
  if (!dlg.open) dlg.showModal();
}

export function openCardPickerDialog(ctx) {
  pickerCtx = {
    ...ctx,
    sharedSources: new Set(["public", "etc", "encounter", "disaster", "monster", "partner", "eidolon", "assault"]),
    currentCombatant: null,
    selectedBase: null,
    selectedUnique: null,
    selectedCommon: null,
    backHandler: null,
  };
  const body = document.getElementById("card-picker-body");
  const dlg = /** @type {HTMLDialogElement|null} */ (document.getElementById("card-picker-dialog"));
  if (!body || !dlg) return;
  renderCharacterStep(body);
  if (!dlg.open) dlg.showModal();
}

/**
 * @param {object} options
 * @param {string} options.openButtonId
 * @param {() => object|null} options.getMeta
 * @param {{ resolveMiscTags: Function }} options.helpers
 * @param {(patch: object, result: object) => void} options.onApply
 */
export async function initCardPicker(options) {
  try {
    await loadCardsBundle();
  } catch (err) {
    const status = document.getElementById("card-search-status");
    if (status) status.textContent = `카드 목록 로드 실패: ${err?.message ?? err}`;
    return null;
  }

  const ctx = {
    getMeta: options.getMeta,
    helpers: options.helpers,
    onApply: options.onApply,
  };

  const openBtn = document.getElementById(options.openButtonId);
  openBtn?.addEventListener("click", () => openCardPickerDialog(ctx));

  const backBtn = document.getElementById("card-picker-back");
  backBtn?.addEventListener("click", () => {
    if (pickerCtx?.backHandler) pickerCtx.backHandler();
  });

  const closeBtn = document.getElementById("card-picker-close");
  closeBtn?.addEventListener("click", () => closePickerDialog());

  return { openSparkPickerForCard: (cardId) => openSparkPickerForCard(cardId, ctx) };
}
