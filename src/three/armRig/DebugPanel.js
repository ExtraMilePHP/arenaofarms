/**
 * DebugPanel — a tiny dependency-free slider panel (no dat.gui / lil-gui).
 *
 * TEMPORARY dev tool for verifying the arm rig. Mount it, add sliders/buttons,
 * call `.dispose()` when done. Pure DOM, fixed to the top-right of the viewport.
 */
export default class DebugPanel {
  constructor({ title = "Debug", parent = document.body } = {}) {
    const el = document.createElement("div");
    el.style.cssText = [
      "position:fixed", "top:12px", "right:12px", "z-index:99999",
      "width:300px", "max-height:88vh", "overflow:auto",
      "background:rgba(14,16,22,0.92)", "color:#dfe6f3",
      "font:12px/1.4 ui-monospace,Menlo,Consolas,monospace",
      "border:1px solid #2b3448", "border-radius:10px", "padding:10px 12px",
      "box-shadow:0 8px 30px rgba(0,0,0,0.5)", "backdrop-filter:blur(4px)",
    ].join(";");

    const head = document.createElement("div");
    head.textContent = title;
    head.style.cssText = "font-weight:700;margin-bottom:8px;letter-spacing:.04em;color:#8fb8ff";
    el.appendChild(head);

    parent.appendChild(el);
    this.el = el;
    this._rows = [];
  }

  section(label) {
    const d = document.createElement("div");
    d.textContent = label;
    d.style.cssText = "margin:10px 0 4px;color:#7d8aa5;text-transform:uppercase;font-size:10px;letter-spacing:.08em";
    this.el.appendChild(d);
    return this;
  }

  /**
   * @param {string} label
   * @param {{min:number,max:number,step?:number,value:number,onChange:(v:number)=>void}} o
   */
  slider(label, o) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin:6px 0";

    const top = document.createElement("div");
    top.style.cssText = "display:flex;justify-content:space-between;gap:8px";
    const name = document.createElement("span");
    name.textContent = label;
    const val = document.createElement("span");
    val.style.color = "#9fd0ff";
    top.append(name, val);

    const input = document.createElement("input");
    input.type = "range";
    input.min = o.min;
    input.max = o.max;
    input.step = o.step ?? 0.001;
    input.value = o.value;
    input.style.cssText = "width:100%;accent-color:#4a9eff";

    const render = (v) => (val.textContent = Number(v).toFixed(3));
    render(o.value);
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      render(v);
      o.onChange(v);
    });

    wrap.append(top, input);
    this.el.appendChild(wrap);
    const row = { input, set: (v) => { input.value = v; render(v); } };
    this._rows.push(row);
    return row;
  }

  button(label, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      "margin:6px 4px 2px 0;padding:5px 10px;background:#26314a;color:#dfe6f3;" +
      "border:1px solid #3a4a6a;border-radius:6px;cursor:pointer;font:inherit";
    b.addEventListener("click", onClick);
    this.el.appendChild(b);
    return b;
  }

  checkbox(label, value, onChange) {
    const wrap = document.createElement("label");
    wrap.style.cssText = "display:flex;align-items:center;gap:6px;margin:6px 0;cursor:pointer";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = value;
    cb.style.accentColor = "#4a9eff";
    cb.addEventListener("change", () => onChange(cb.checked));
    const span = document.createElement("span");
    span.textContent = label;
    wrap.append(cb, span);
    this.el.appendChild(wrap);
    return cb;
  }

  note(text) {
    const d = document.createElement("div");
    d.textContent = text;
    d.style.cssText = "margin:6px 0;color:#7d8aa5;font-size:11px";
    this.el.appendChild(d);
    return d;
  }

  dispose() {
    this.el.remove();
  }
}
