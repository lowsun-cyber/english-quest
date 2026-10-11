/*
 * dc-shim.js — минимальный рантайм, чтобы эскизы с холста открывались как обычные страницы.
 * Поддерживает то, что используют доски: <x-dc>, <helmet>, {{выражения}}, <sc-for>, <sc-if>,
 * onClick="{{fn}}" и класс Component extends DCLogic с renderVals() и setState().
 * Это инструмент просмотра эскизов, а не код игры: в игру переносится разметка и стили.
 */
(function () {
  class DCLogic {
    constructor(rerender) { this.state = {}; this._rerender = rerender; }
    setState(patch) { Object.assign(this.state, patch); this._rerender(); }
    renderVals() { return {}; }
  }
  window.DCLogic = DCLogic;

  function evalExpr(expr, scope) {
    const keys = Object.keys(scope);
    try { return new Function(...keys, 'return (' + expr + ');')(...keys.map((k) => scope[k])); }
    catch (e) { return undefined; }
  }
  const ONE = /^\s*\{\{([\s\S]+?)\}\}\s*$/;
  const ANY = /\{\{([\s\S]+?)\}\}/g;
  const fill = (str, scope) => str.replace(ANY, (_, e) => { const v = evalExpr(e, scope); return v == null ? '' : String(v); });

  function render(node, scope, out) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(fill(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'sc-for') {
      const m = (node.getAttribute('list') || '').match(ONE);
      const list = m ? evalExpr(m[1], scope) : [];
      const as = node.getAttribute('as') || 'item';
      (list || []).forEach((item, i) => {
        const s = Object.assign({}, scope, { [as]: item, index: i });
        node.childNodes.forEach((c) => render(c, s, out));
      });
      return;
    }
    if (tag === 'sc-if') {
      const m = (node.getAttribute('value') || '').match(ONE);
      if (m && evalExpr(m[1], scope)) node.childNodes.forEach((c) => render(c, scope, out));
      return;
    }
    const isSvg = node.namespaceURI === 'http://www.w3.org/2000/svg';
    const el = isSvg ? document.createElementNS(node.namespaceURI, node.tagName) : document.createElement(node.tagName);
    for (const a of Array.from(node.attributes)) {
      if (a.name.startsWith('hint-')) continue;
      const m = a.value.match(ONE);
      if (a.name.startsWith('on') && m) {
        const fn = evalExpr(m[1], scope);
        if (typeof fn === 'function') el.addEventListener(a.name.slice(2).toLowerCase(), fn);
        continue;
      }
      el.setAttribute(a.name, fill(a.value, scope));
    }
    const kids = node.content ? node.content.childNodes : node.childNodes;
    kids.forEach((c) => render(c, scope, el));
    out.appendChild(el);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const host = document.querySelector('x-dc');
    if (!host) return;
    const helmet = host.querySelector('helmet');
    if (helmet) { Array.from(helmet.childNodes).forEach((n) => document.head.appendChild(n)); helmet.remove(); }
    const tpl = document.createElement('template');
    tpl.innerHTML = host.innerHTML;
    const script = document.querySelector('script[data-dc-script]');
    let Component = DCLogic;
    if (script) { try { Component = new Function('DCLogic', script.textContent + '\nreturn Component;')(DCLogic); } catch (e) { console.error(e); } }
    let comp;
    const draw = () => {
      const vals = comp.renderVals() || {};
      const frag = document.createDocumentFragment();
      tpl.content.childNodes.forEach((c) => render(c, vals, frag));
      host.replaceChildren(frag);
    };
    comp = new Component(draw);
    comp._rerender = draw;
    draw();
  });
})();
