/** @typedef {{ id: string, name: string, name_key?: string, description?: string, cost: number, filter_cost: number, type: string, class: string|null, tags: string[], exhaust?: boolean, source?: string }} CardCatalogEntry */

export const CARDS_DATA_V = 7;

/** @param {CardCatalogEntry} card @param {object} meta @param {{ resolveMiscTags: (meta: object) => { code: string }[] }} helpers */
export function cardToFilterPatch(card, meta, helpers) {
  const uiTagCodes = (meta.tags ?? []).map((t) => t.code);
  const miscCodes = helpers.resolveMiscTags(meta).map((t) => t.code);
  const tagSet = new Set(card.tags ?? []);
  const hasExhaust = !!(card.exhaust || tagSet.has("exhaust"));

  /** @type {Record<string, string>} */
  const tagStates = {};
  for (const code of uiTagCodes) {
    if (code === "exhaust") {
      tagStates[code] = hasExhaust ? "포함" : "없음";
    } else if (tagSet.has(code)) {
      tagStates[code] = "포함";
    } else {
      tagStates[code] = "없음";
    }
  }

  const miscTags = miscCodes.filter((code) => tagSet.has(code));
  const filterCost =
    typeof card.filter_cost === "number" ? card.filter_cost : card.cost;

  return {
    cost: Math.max(0, Math.min(4, filterCost)),
    typeCode: card.type ?? "",
    classCode: card.class ?? "",
    tagStates,
    miscTags,
  };
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cardSearchBlob(card) {
  return normalizeSearchText(
    [card.name, card.id, card.name_key, card.source, card.description]
      .filter(Boolean)
      .join(" ")
  );
}

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

/**
 * @param {object} options
 * @param {string} options.inputId
 * @param {string} options.listId
 * @param {string} [options.statusId]
 * @param {() => object|null} options.getMeta
 * @param {{ resolveMiscTags: (meta: object) => { code: string }[] }} options.helpers
 * @param {(patch: object, card: CardCatalogEntry) => void} options.onApply
 * @param {(card: CardCatalogEntry) => void} [options.onCardPicked] 검색 선택 후 번뜩임 선택으로 이동
 */
export async function initCardSearch(options) {
  const input = /** @type {HTMLInputElement|null} */ (
    document.getElementById(options.inputId)
  );
  const list = document.getElementById(options.listId);
  const status = options.statusId
    ? document.getElementById(options.statusId)
    : null;
  if (!input || !list) return;

  list.hidden = true;
  /** @type {CardCatalogEntry[]} */
  let cards = [];
  /** @type {{ card: CardCatalogEntry, blob: string }[]} */
  let index = [];

  try {
    const res = await fetch(`data/cards.json?v=${CARDS_DATA_V}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cards = Array.isArray(data.cards) ? data.cards : [];
    index = cards.map((card) => ({ card, blob: cardSearchBlob(card) }));
    if (status) {
      status.textContent = `카드 ${cards.length.toLocaleString()}장 검색 가능`;
    }
  } catch (err) {
    if (status) {
      status.textContent = `카드 목록 로드 실패: ${err?.message ?? err}`;
    }
    return;
  }

  /** @type {number} */
  let activeIndex = -1;
  /** @type {CardCatalogEntry[]} */
  let visible = [];

  function hideList() {
    list.hidden = true;
    list.replaceChildren();
    activeIndex = -1;
    visible = [];
  }

  function renderMatches(query) {
    const q = normalizeSearchText(query);
    if (!q) {
      hideList();
      return;
    }

    const hits = [];
    for (const row of index) {
      if (row.blob.includes(q) || row.card.id.toLowerCase().includes(q)) {
        hits.push(row.card);
        if (hits.length >= 12) break;
      }
    }
    visible = hits;
    list.replaceChildren();

    if (!hits.length) {
      const empty = document.createElement("div");
      empty.className = "card-search-empty";
      empty.textContent = "일치하는 카드 없음";
      list.appendChild(empty);
      list.hidden = false;
      activeIndex = -1;
      return;
    }

    hits.forEach((card, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card-search-item";
      btn.dataset.index = String(i);
      const desc = card.description ?? "";
      const metaLine = [
        `${card.filter_cost ?? card.cost}코`,
        typeShort(card.type),
        card.class ?? "전체 직업",
        card.id,
      ].join(" · ");
      const descHtml = desc
        ? `<em class="card-search-desc">${escapeHtml(desc)}</em>`
        : "";
      btn.innerHTML = `<strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(metaLine)}</span>${descHtml}`;
      btn.addEventListener("mousedown", (ev) => ev.preventDefault());
      btn.addEventListener("click", () => selectCard(card));
      list.appendChild(btn);
    });

    list.hidden = false;
    activeIndex = 0;
    highlightActive();
  }

  function highlightActive() {
    const items = list.querySelectorAll(".card-search-item");
    items.forEach((el, i) => {
      el.classList.toggle("is-active", i === activeIndex);
    });
    const active = items[activeIndex];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function selectCard(card) {
    if (options.onCardPicked) {
      options.onCardPicked(card);
      input.value = card.name;
      hideList();
      return;
    }
    const meta = options.getMeta();
    if (!meta) return;
    const patch = cardToFilterPatch(card, meta, options.helpers);
    options.onApply(patch, card);
    input.value = card.name;
    hideList();
    if (status) {
      const costNote =
        card.cost !== patch.cost ? ` (실제 코스트 ${card.cost})` : "";
      status.textContent = `적용: ${card.name} · ${patch.cost}코${costNote} · ${typeShort(card.type)}`;
    }
  }

  input.addEventListener("input", () => renderMatches(input.value));
  input.addEventListener("focus", () => {
    if (normalizeSearchText(input.value)) renderMatches(input.value);
  });
  input.addEventListener("keydown", (ev) => {
    if (list.hidden) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (!visible.length) return;
      activeIndex = Math.min(visible.length - 1, activeIndex + 1);
      highlightActive();
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!visible.length) return;
      activeIndex = Math.max(0, activeIndex - 1);
      highlightActive();
    } else if (ev.key === "Enter") {
      if (activeIndex >= 0 && visible[activeIndex]) {
        ev.preventDefault();
        selectCard(visible[activeIndex]);
      }
    } else if (ev.key === "Escape") {
      hideList();
    }
  });

  document.addEventListener("click", (ev) => {
    if (ev.target === input || list.contains(/** @type {Node} */ (ev.target))) return;
    hideList();
  });
}
