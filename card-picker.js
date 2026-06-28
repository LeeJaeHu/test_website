import { cardToFilterPatch, CARDS_DATA_V } from "./card-search.js";

/** @typedef {{ id: number, name: string, portrait: string, card_count: number }} Combatant */
/** @typedef {{ id: string, result_id: string, kind: string, name?: string }} UniqueSpark */
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

function cardTileHtml(card, { compact = false } = {}) {
  const cost = card.filter_cost ?? card.cost;
  const cls = cardTypeClass(card.type);
  const sub = compact
    ? `${cost}코 · ${typeShort(card.type)}`
    : `${cost}코 · ${typeShort(card.type)} · ${card.id}`;
  return `<article class="picker-card-tile ${cls}" data-card-id="${escapeHtml(card.id)}" title="${escapeHtml(card.name)}">
    <div class="picker-card-art" aria-hidden="true"><span class="picker-card-cost">${cost}</span></div>
    <div class="picker-card-caption">
      <strong>${escapeHtml(card.name)}</strong>
      <span>${escapeHtml(sub)}</span>
    </div>
  </article>`;
}

function sparkTileHtml({ id, title, subtitle, kind, selected }) {
  const kindClass = kind ? `spark-tile-${kind}` : "";
  return `<button type="button" class="picker-spark-tile ${kindClass}${selected ? " is-selected" : ""}" data-spark-id="${escapeHtml(id)}" data-spark-kind="${escapeHtml(kind || "")}">
    <span class="picker-spark-icon" aria-hidden="true"></span>
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(subtitle)}</span>
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
    parts.push(`고유: ${result.uniqueSpark.name || result.uniqueSpark.id}`);
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
  preview.innerHTML = cardTileHtml(baseCard, { compact: true });
  body.appendChild(preview);

  const uniqueSection = document.createElement("section");
  uniqueSection.className = "picker-spark-section";
  uniqueSection.innerHTML = `<h4>고유 번뜩임</h4>`;
  const uniqueGrid = document.createElement("div");
  uniqueGrid.className = "picker-grid picker-spark-grid";

  uniqueGrid.appendChild(
    (() => {
      const el = document.createElement("div");
      el.innerHTML = sparkTileHtml({
        id: "__base__",
        title: "원본",
        subtitle: "번뜩임 없음",
        kind: "base",
        selected: true,
      });
      const btn = el.firstElementChild;
      btn.addEventListener("click", () => selectUnique(null, uniqueGrid));
      return btn;
    })()
  );

  for (const u of baseCard.unique ?? []) {
    const result = cardsById.get(u.result_id);
    const el = document.createElement("div");
    el.innerHTML = sparkTileHtml({
      id: u.id,
      title: u.name || u.result_id,
      subtitle: u.kind === "pot" ? "포텐셜" : "고유 번뜩임",
      kind: "unique",
      selected: false,
    });
    const btn = el.firstElementChild;
    btn.addEventListener("click", () => selectUnique(u, uniqueGrid));
    uniqueGrid.appendChild(btn);
  }
  uniqueSection.appendChild(uniqueGrid);
  body.appendChild(uniqueSection);

  const commonSection = document.createElement("section");
  commonSection.className = "picker-spark-section";
  commonSection.innerHTML = `<h4>일반 번뜩임</h4><p class="hint">선택 시 카드 코스트 등이 변할 수 있습니다 (신 번뜩임 조회 전 상태).</p>`;
  const commonGrid = document.createElement("div");
  commonGrid.className = "picker-grid picker-spark-grid";

  commonGrid.appendChild(
    (() => {
      const el = document.createElement("div");
      el.innerHTML = sparkTileHtml({
        id: "__none__",
        title: "없음",
        subtitle: "일반 번뜩임 없음",
        kind: "none",
        selected: true,
      });
      const btn = el.firstElementChild;
      btn.addEventListener("click", () => selectCommon(null, commonGrid));
      return btn;
    })()
  );

  for (const sid of baseCard.commons ?? []) {
    const cs = commonSparks[sid];
    if (!cs) continue;
    const el = document.createElement("div");
    const delta = cs.cost_delta ? `코스트 ${cs.cost_delta > 0 ? "+" : ""}${cs.cost_delta}` : "효과";
    el.innerHTML = sparkTileHtml({
      id: sid,
      title: cs.description.slice(0, 36) || sid,
      subtitle: delta,
      kind: "common",
      selected: false,
    });
    const btn = el.firstElementChild;
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
  grid.querySelectorAll(".picker-spark-tile").forEach((el) => {
    const kid = el.getAttribute("data-spark-kind");
    el.classList.toggle("is-selected", kid === "base" ? !unique : el.getAttribute("data-spark-id") === unique?.id);
  });
}

function selectCommon(commonId, grid) {
  pickerCtx.selectedCommon = commonId;
  grid.querySelectorAll(".picker-spark-tile").forEach((el) => {
    const kid = el.getAttribute("data-spark-kind");
    el.classList.toggle(
      "is-selected",
      kid === "none" ? !commonId : el.getAttribute("data-spark-id") === commonId
    );
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
