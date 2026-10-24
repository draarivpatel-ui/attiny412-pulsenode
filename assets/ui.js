// Small DOM and formatting helpers shared by the inspection pages. No dependencies.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
};

export const mm = (v, d = 2) => `${+(+v).toFixed(d)} mm`;
export const num = (v, d = 2) => (+v).toFixed(d);

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

let toastTimer;
export function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) { el = h("div", { class: "toast", role: "status", "aria-live": "polite" }); document.body.append(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

export async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h("textarea", { style: "position:fixed;opacity:0" }); ta.value = text;
    document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  toast("Copied to clipboard");
  if (button) { button.classList.add("is-done"); setTimeout(() => button.classList.remove("is-done"), 1200); }
}

export function kv(dl, rows) {
  dl.replaceChildren(...rows.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", {}, v)]));
}

/** Arrow-key tablist. panels maps tab id to a panel element. */
export function tabs(list, panels, onChange) {
  const buttons = [...list.querySelectorAll("button")];
  const select = (id, focus = false) => {
    buttons.forEach((b) => {
      const on = b.dataset.tab === id;
      b.setAttribute("aria-selected", on);
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    Object.entries(panels).forEach(([k, el]) => { el.hidden = k !== id; });
    onChange?.(id);
  };
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => select(b.dataset.tab));
    b.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (d) { e.preventDefault(); select(buttons[(i + d + buttons.length) % buttons.length].dataset.tab, true); }
    });
  });
  select(buttons.find((b) => b.getAttribute("aria-selected") === "true")?.dataset.tab ?? buttons[0].dataset.tab);
  return select;
}

/** Download bench. groups: [{title, files:[{path, desc}]}]. manifest: files.json rows. */
export function bench(root, groups, manifest) {
  const by = new Map(manifest.map((m) => [m.path, m]));
  root.replaceChildren(...groups.flatMap((g) => [
    h("div", { class: "bench-group", text: g.title }),
    ...g.files.map((f) => {
      const m = by.get(f.path);
      const copyBtn = m ? h("button", { class: "chip-btn", type: "button", "aria-label": `Copy SHA-256 of ${f.path}`,
        onclick: (e) => copy(m.sha256, e.currentTarget) }, "Copy SHA-256") : null;
      return h("div", { class: "file" },
        h("div", {}, h("span", { class: "fname", text: f.path }), m && h("span", { class: "hash", text: `sha256 ${m.sha256.slice(0, 16)}...` })),
        h("div", { class: "fdesc", text: f.desc }),
        h("div", { class: "fsize", text: m ? fmtBytes(m.bytes) : "" }),
        h("div", { class: "actions" }, copyBtn, h("a", { class: "btn primary", href: f.path, download: f.path.split("/").pop() }, "Download")));
    }),
  ]));
}
