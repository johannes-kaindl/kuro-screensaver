// Obsidian DOM polyfill — adds the `createEl/createDiv/createSpan/empty`
// helpers Obsidian extends onto HTMLElement.prototype, so the engine code
// (which was written against the Obsidian API) runs unmodified in the
// standalone web build. Import once at the host entrypoint.

type ElInfo = {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  type?: string;
  value?: string;
  href?: string;
  placeholder?: string;
};

function applyInfo(el: HTMLElement, info?: ElInfo) {
  if (!info) return;
  if (info.cls) {
    const classes = Array.isArray(info.cls) ? info.cls : info.cls.split(/\s+/);
    for (const c of classes) if (c) el.classList.add(c);
  }
  if (info.text != null) el.textContent = info.text;
  if (info.title) el.title = info.title;
  if (info.attr) {
    for (const [k, v] of Object.entries(info.attr)) {
      if (v == null) continue;
      el.setAttribute(k, String(v));
    }
  }
  if (info.type) (el as HTMLInputElement).type = info.type;
  if (info.value != null) (el as HTMLInputElement).value = info.value;
  if (info.href) (el as HTMLAnchorElement).href = info.href;
  if (info.placeholder) (el as HTMLInputElement).placeholder = info.placeholder;
}

const proto = HTMLElement.prototype as any;

if (typeof proto.createEl !== 'function') {
  proto.createEl = function <K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement,
    tag: K,
    info?: ElInfo,
    callback?: (el: HTMLElementTagNameMap[K]) => void,
  ): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    applyInfo(el as unknown as HTMLElement, info);
    this.appendChild(el);
    if (callback) callback(el);
    return el;
  };
}

if (typeof proto.createDiv !== 'function') {
  proto.createDiv = function (
    this: HTMLElement,
    info?: ElInfo,
    callback?: (el: HTMLDivElement) => void,
  ): HTMLDivElement {
    return (this as any).createEl('div', info, callback);
  };
}

if (typeof proto.createSpan !== 'function') {
  proto.createSpan = function (
    this: HTMLElement,
    info?: ElInfo,
    callback?: (el: HTMLSpanElement) => void,
  ): HTMLSpanElement {
    return (this as any).createEl('span', info, callback);
  };
}

if (typeof proto.empty !== 'function') {
  proto.empty = function (this: HTMLElement): void {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
}

declare global {
  interface HTMLElement {
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      info?: ElInfo,
      callback?: (el: HTMLElementTagNameMap[K]) => void,
    ): HTMLElementTagNameMap[K];
    createDiv(info?: ElInfo, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
    createSpan(info?: ElInfo, callback?: (el: HTMLSpanElement) => void): HTMLSpanElement;
    empty(): void;
  }
}

export {};
