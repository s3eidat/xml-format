/* XML Format — validation with DOMParser("application/xml"): an inert document that is never attached to the page. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var XHTML = "http://www.w3.org/1999/xhtml";

  // ================= validation =================
  function parseXml(text) {
    var doc = new DOMParser().parseFromString(text, "application/xml");
    var pe = doc.getElementsByTagNameNS(XHTML, "parsererror")[0] ||
      (doc.documentElement && doc.documentElement.nodeName === "parsererror" ? doc.documentElement : null);
    if (!pe) return { ok: true, doc: doc };
    var msg = (pe.textContent || "Invalid XML").replace(/\s+/g, " ").trim(), at = null, m;
    if ((m = /line (\d+) at column (\d+):\s*(.*?)(?:Below is a rendering.*)?$/i.exec(msg))) { at = { line: +m[1], col: +m[2] }; msg = m[3]; }
    else if ((m = /Line Number (\d+), Column (\d+)/i.exec(msg))) { at = { line: +m[1], col: +m[2] }; msg = msg.replace(/Location:.*$/, "").replace(/^XML Parsing Error:\s*/i, ""); }
    return { ok: false, error: msg.trim(), at: at };
  }

  // ================= tokenizer / tree (keeps the source text exactly) =================
  function tagEnd(s, i) {
    var q = null;
    for (var j = i + 1; j < s.length; j++) {
      var c = s[j];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === ">") return j + 1;
    }
    return s.length;
  }
  function doctypeEnd(s, i) {
    var depth = 0, q = null;
    for (var j = i + 2; j < s.length; j++) {
      var c = s[j];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === "[") depth++;
      else if (c === "]") depth--;
      else if (c === ">" && depth <= 0) return j + 1;
    }
    return s.length;
  }
  function normTag(raw) { // whitespace between attributes only; values untouched
    var out = "", q = null, sp = false;
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (q) { out += c; if (c === q) q = null; continue; }
      if (/\s/.test(c)) { sp = true; continue; }
      if (sp) { if (c !== ">" && c !== "=" && !/=$/.test(out) && !(c === "/" && raw[i + 1] === ">")) out += " "; sp = false; }
      if (c === '"' || c === "'") q = c;
      out += c;
    }
    return out;
  }
  function tokens(s) {
    var toks = [], i = 0, n = s.length, e;
    while (i < n) {
      if (s[i] !== "<") { e = s.indexOf("<", i); if (e < 0) e = n; toks.push({ t: "text", v: s.slice(i, e) }); i = e; continue; }
      if (s.startsWith("<!--", i)) { e = s.indexOf("-->", i + 4); e = e < 0 ? n : e + 3; toks.push({ t: "comment", v: s.slice(i, e) }); i = e; continue; }
      if (s.startsWith("<![CDATA[", i)) { e = s.indexOf("]]>", i); e = e < 0 ? n : e + 3; toks.push({ t: "cdata", v: s.slice(i, e) }); i = e; continue; }
      if (s.startsWith("<?", i)) { e = s.indexOf("?>", i); e = e < 0 ? n : e + 2; toks.push({ t: "pi", v: s.slice(i, e) }); i = e; continue; }
      if (s.startsWith("<!", i)) { e = doctypeEnd(s, i); toks.push({ t: "doctype", v: s.slice(i, e) }); i = e; continue; }
      if (s[i + 1] === "/") { e = s.indexOf(">", i); e = e < 0 ? n : e + 1; toks.push({ t: "close", v: s.slice(i, e).replace(/\s+/g, "") }); i = e; continue; }
      e = tagEnd(s, i);
      var raw = s.slice(i, e);
      toks.push({ t: "open", v: normTag(raw), self: /\/\s*>$/.test(raw), preserve: /\sxml:space\s*=\s*["']preserve["']/.test(raw) });
      i = e;
    }
    return toks;
  }
  function tree(s) {
    var root = { kids: [] }, stack = [root];
    tokens(s).forEach(function (k) {
      var top = stack[stack.length - 1];
      if (k.t === "open") {
        var node = { t: "el", open: k.v, kids: [], close: "", preserve: k.preserve || top.preserve };
        top.kids.push(node);
        if (!k.self) stack.push(node);
      } else if (k.t === "close") { if (stack.length > 1) { top.close = k.v; stack.pop(); } }
      else top.kids.push(k);
    });
    return root;
  }
  function isWs(k) { return k.t === "text" && !/\S/.test(k.v); }
  function raw(n) { return n.t === "el" ? n.open + n.kids.map(raw).join("") + n.close : n.v; }
  function hasText(n) { return n.kids.some(function (k) { return (k.t === "text" && !isWs(k)) || k.t === "cdata"; }); }
  function hasEl(n) { return n.kids.some(function (k) { return k.t === "el"; }); }

  function pretty(src, unit, dropComments) {
    var lines = [];
    function walk(kids, d) {
      kids.forEach(function (k) {
        if (isWs(k)) return;
        if (k.t === "comment" && dropComments) return;
        var pad = unit.repeat(d);
        if (k.t !== "el") { lines.push(pad + (k.t === "text" ? k.v.trim() : k.v)); return; }
        if (k.preserve || (hasText(k) && hasEl(k))) { lines.push(pad + raw(k)); return; } // mixed content stays exactly as written
        if (!hasEl(k) && !k.kids.some(function (x) { return x.t === "comment" || x.t === "pi"; })) {
          lines.push(pad + k.open + k.kids.map(raw).join("") + k.close); return;
        }
        lines.push(pad + k.open);
        walk(k.kids, d + 1);
        if (k.close) lines.push(pad + k.close);
      });
    }
    walk(tree(src).kids, 0);
    return lines.join("\n");
  }
  function minify(src, dropComments) {
    function walk(kids, keepWs) {
      return kids.map(function (k) {
        if (k.t === "comment") return dropComments ? "" : k.v;
        if (isWs(k)) return keepWs ? k.v : "";
        if (k.t !== "el") return k.v;
        var keep = k.preserve || hasText(k);
        return k.open + walk(k.kids, keep) + k.close;
      }).join("");
    }
    return walk(tree(src).kids, false);
  }

  // ================= DOM helpers: tree view, JSON, XPath =================
  function namespaces(doc) {
    var map = {}, defaultNs = doc.documentElement ? doc.documentElement.namespaceURI : null;
    var all = doc.getElementsByTagName("*");
    for (var i = 0; i < all.length && i < 20000; i++) {
      var at = all[i].attributes;
      for (var j = 0; j < at.length; j++) {
        var m = /^xmlns:(.+)$/.exec(at[j].name);
        if (m && !(m[1] in map)) map[m[1]] = at[j].value;
      }
    }
    if (defaultNs && !doc.documentElement.prefix) {
      var p = "d"; while (p in map) p += "d";
      map[p] = defaultNs; map.__default = p;
    }
    return map;
  }
  function xpath(doc, expr) {
    var ns = namespaces(doc);
    var res = doc.evaluate(expr, doc, function (pfx) { return ns[pfx] || null; }, XPathResult.ANY_TYPE, null);
    switch (res.resultType) {
      case XPathResult.NUMBER_TYPE: return { kind: "number", value: res.numberValue };
      case XPathResult.STRING_TYPE: return { kind: "string", value: res.stringValue };
      case XPathResult.BOOLEAN_TYPE: return { kind: "boolean", value: res.booleanValue };
      default:
        var nodes = [], n;
        while ((n = res.iterateNext())) nodes.push(n);
        return { kind: "nodes", nodes: nodes };
    }
  }
  var ser = new XMLSerializer();
  function nodeText(n) {
    if (n.nodeType === 2) return n.name + '="' + n.value + '"';
    if (n.nodeType === 3 || n.nodeType === 4) return n.data;
    if (n.nodeType === 9) return "(the whole document)";
    return ser.serializeToString(n);
  }
  function toJson(el) {
    var o = {}, attrs = el.attributes, kids = el.childNodes, text = "", hasKids = false;
    for (var i = 0; i < attrs.length; i++) o["@" + attrs[i].name] = attrs[i].value;
    for (var j = 0; j < kids.length; j++) {
      var k = kids[j];
      if (k.nodeType === 1) {
        hasKids = true;
        var v = toJson(k), name = k.nodeName;
        if (Object.prototype.hasOwnProperty.call(o, name)) { if (!Array.isArray(o[name])) o[name] = [o[name]]; o[name].push(v); }
        else o[name] = v;
      } else if (k.nodeType === 3 || k.nodeType === 4) text += k.data;
    }
    text = text.trim();
    if (!hasKids && attrs.length === 0) return text;
    if (text) o["#text"] = text;
    return o;
  }
  function xmlToJson(doc) { var r = {}; r[doc.documentElement.nodeName] = toJson(doc.documentElement); return r; }
  function pathOf(el, ns) {
    var parts = [];
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      var name = n.prefix || !n.namespaceURI ? n.nodeName : (ns.__default ? ns.__default + ":" : "") + n.localName, idx = 1, same = 0;
      for (var s = n.parentNode && n.parentNode.firstChild; s; s = s.nextSibling) if (s.nodeType === 1 && s.nodeName === n.nodeName) { same++; if (s === n) idx = same; }
      parts.unshift(name + (same > 1 ? "[" + idx + "]" : ""));
    }
    return "/" + parts.join("/");
  }

  // ================= UI =================
  var input = $("#input"), out = $("#out"), treeBox = $("#tree"), status = $("#status"), stats = $("#stats");
  var state = { doc: null, view: "text", mode: "format", text: "", json: "", ns: {} };
  var saved = S3.store("xf.opts") || {};
  if (saved.indent) $("#indent").value = saved.indent;
  $("#nocom").checked = !!saved.nocom;

  function hl(text) {
    var html = "";
    tokens(text).forEach(function (k) {
      if (k.t === "open" || k.t === "close") {
        html += S3.esc(k.v).replace(/^(&lt;\/?)([^\s&\/]+)/, '$1<span class="xf-t">$2</span>')
          .replace(/(\s)([^\s=]+)=(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;)/g, '$1<span class="xf-a">$2</span>=<span class="xf-v">$3</span>');
      } else if (k.t === "comment") html += '<span class="xf-c">' + S3.esc(k.v) + "</span>";
      else if (k.t === "text") html += S3.esc(k.v);
      else html += '<span class="xf-d">' + S3.esc(k.v) + "</span>";
    });
    return html;
  }
  function stat(label, value) { return '<div class="stat"><b>' + S3.esc(value) + "</b><span>" + S3.esc(label) + "</span></div>"; }

  function render(action) {
    var src = input.value;
    S3.store("xf.opts", { indent: $("#indent").value, nocom: $("#nocom").checked });
    if (action) state.mode = action;
    stats.innerHTML = ""; state.doc = null; state.text = ""; state.json = "";
    if (!src.trim()) { status.className = "chip"; status.textContent = "Waiting for XML"; out.textContent = ""; treeBox.innerHTML = ""; renderNs(); runXpath(); return; }
    var r = parseXml(src);
    if (!r.ok) {
      status.className = "chip bad"; status.textContent = r.at ? "Error at line " + r.at.line + ", col " + r.at.col : "Invalid XML";
      var lines = src.split("\n"), html = S3.esc(r.error) + "\n\n";
      if (r.at) {
        var from = Math.max(0, r.at.line - 4), to = Math.min(lines.length, r.at.line + 2);
        for (var i = from; i < to; i++) {
          var ln = String(i + 1).padStart(4) + " │ " + S3.esc(lines[i]);
          html += i + 1 === r.at.line ? '<span class="xf-err">' + ln + "\n" + " ".repeat(Math.max(0, 6 + r.at.col)) + "^</span>" : ln + "\n";
        }
      }
      out.innerHTML = html; treeBox.innerHTML = ""; setView("text", true); renderNs(); runXpath(); return;
    }
    var unit = $("#indent").value === "tab" ? "\t" : " ".repeat(+$("#indent").value), drop = $("#nocom").checked;
    state.doc = r.doc;
    state.text = state.mode === "minify" ? minify(src, drop) : pretty(src, unit, drop);
    state.json = JSON.stringify(xmlToJson(r.doc), null, unit === "\t" ? "\t" : unit.length);
    status.className = "chip ok"; status.textContent = "Valid XML";
    var els = r.doc.getElementsByTagName("*").length, depth = 0;
    (function d(n, k) { if (k > depth) depth = k; for (var c = n.firstElementChild; c; c = c.nextElementSibling) d(c, k + 1); })(r.doc.documentElement, 1);
    stats.innerHTML = stat("elements", els.toLocaleString()) + stat("depth", depth) +
      stat("input", S3.fmtBytes(new Blob([src]).size)) + stat(state.mode === "minify" ? "minified" : "formatted", S3.fmtBytes(new Blob([state.text]).size));
    showView(); renderNs(); runXpath();
    if (action) S3.done();
  }
  function showView() {
    out.hidden = state.view === "tree"; treeBox.hidden = state.view !== "tree";
    $("#ext").textContent = state.view === "json" ? ".json" : ".xml";
    if (!state.doc) return;
    if (state.view === "text") out.innerHTML = hl(state.text);
    else if (state.view === "json") out.textContent = state.json;
    else drawTree();
  }
  function setView(v, silent) {
    state.view = v;
    $$("#view button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === v)); });
    if (!silent) showView(); else { out.hidden = false; treeBox.hidden = true; }
  }

  // ---------- tree (children built on expand) ----------
  function label(el) {
    var frag = document.createDocumentFragment();
    frag.appendChild(S3.h("span", { "class": "xf-t xf-k", title: "Copy XPath", text: el.nodeName }));
    for (var i = 0; i < el.attributes.length && i < 12; i++) {
      var a = el.attributes[i];
      frag.appendChild(document.createTextNode(" "));
      frag.appendChild(S3.h("span", { "class": "xf-a", text: a.name }));
      frag.appendChild(document.createTextNode("="));
      frag.appendChild(S3.h("span", { "class": "xf-v", text: '"' + (a.value.length > 60 ? a.value.slice(0, 60) + "…" : a.value) + '"' }));
    }
    return frag;
  }
  function node(el, open) {
    var li = document.createElement("li"), kids = el.childNodes, elKids = el.children.length, text = "";
    for (var i = 0; i < kids.length; i++) if (kids[i].nodeType === 3 || kids[i].nodeType === 4) text += kids[i].data;
    text = text.trim();
    var tog = S3.h("span", { "class": "xf-tog", text: elKids ? (open ? "▾" : "▸") : "" });
    li.appendChild(tog); li.appendChild(label(el));
    if (text && !elKids) { li.appendChild(document.createTextNode(" ")); li.appendChild(S3.h("span", { "class": "xf-txt", text: text.length > 120 ? text.slice(0, 120) + "…" : text })); }
    else if (elKids) li.appendChild(S3.h("span", { "class": "xf-meta", text: " " + elKids + (elKids === 1 ? " child" : " children") }));
    li._el = el; li._open = false;
    if (open && elKids) expand(li);
    return li;
  }
  function expand(li) {
    var ul = document.createElement("ul"), el = li._el;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) ul.appendChild(node(c, false));
      else if (c.nodeType === 8) ul.appendChild(S3.h("li", { "class": "xf-c" }, [S3.h("span", { "class": "xf-tog" }), "<!--" + c.data + "-->"]));
      else if ((c.nodeType === 3 || c.nodeType === 4) && c.data.trim() && el.children.length) ul.appendChild(S3.h("li", null, [S3.h("span", { "class": "xf-tog" }), S3.h("span", { "class": "xf-txt", text: c.data.trim() })]));
    }
    li.appendChild(ul); li._open = true; li.firstChild.textContent = "▾";
  }
  function drawTree() {
    treeBox.innerHTML = "";
    if (!state.doc) return;
    var ul = document.createElement("ul"); ul.appendChild(node(state.doc.documentElement, true)); treeBox.appendChild(ul);
  }
  treeBox.addEventListener("click", function (e) {
    var k = e.target.closest(".xf-k"), li;
    if (k) { li = k.parentNode; S3.copy(pathOf(li._el, namespaces(state.doc)), "XPath copied"); return; }
    var tog = e.target.closest(".xf-tog"); li = tog && tog.parentNode;
    if (!li || !li._el || !li._el.children.length) return;
    if (li._open) { li.removeChild(li.lastChild); li._open = false; tog.textContent = "▸"; } else expand(li);
  });

  // ---------- XPath ----------
  function renderNs() {
    var box = $("#ns"); box.innerHTML = "";
    if (!state.doc) return;
    var ns = state.ns = namespaces(state.doc);
    Object.keys(ns).filter(function (k) { return k !== "__default"; }).slice(0, 6).forEach(function (p) {
      box.appendChild(S3.h("span", { "class": "chip", title: ns[p], text: p + ": " + (ns[p].length > 34 ? ns[p].slice(0, 34) + "…" : ns[p]) + (p === ns.__default ? " (default)" : "") }));
    });
  }
  function runXpath() {
    var expr = $("#xpath").value.trim(), box = $("#xres"), st = $("#xstatus"), inf = $("#xinfo");
    box.innerHTML = ""; inf.textContent = "";
    if (!state.doc || !expr) { st.className = "chip"; st.textContent = state.doc ? "Type an XPath expression" : "Needs valid XML"; return; }
    S3.store("xf.xpath", expr);
    var r;
    try { r = xpath(state.doc, expr); }
    catch (e) { st.className = "chip bad"; st.textContent = "Invalid XPath"; inf.textContent = String(e.message || e).replace(/^Failed to execute 'evaluate' on 'Document': /, ""); return; }
    st.className = "chip ok";
    if (r.kind !== "nodes") { st.textContent = r.kind; box.appendChild(S3.h("pre", { "class": "out xf-r", text: String(r.value) })); return; }
    st.textContent = r.nodes.length + (r.nodes.length === 1 ? " node" : " nodes");
    if (!r.nodes.length) { box.appendChild(S3.h("div", { "class": "empty" }, [S3.h("b", { text: "No match" }), state.ns.__default ? "This document has a default namespace: prefix element names with " + state.ns.__default + ": (e.g. //" + state.ns.__default + ":item)." : "Try //* to list every element."])); return; }
    r.nodes.slice(0, 300).forEach(function (n) {
      var b = S3.h("button", { "class": "out xf-r", type: "button", title: "Click to copy", text: nodeText(n) });
      b.addEventListener("click", function () { S3.copy(nodeText(n)); });
      box.appendChild(b);
    });
    if (r.nodes.length > 300) inf.textContent = "Showing the first 300.";
  }

  var SAMPLE = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- a small book catalog -->\n<catalog xmlns="https://s3eidat.github.io/ns/catalog" xmlns:x="https://s3eidat.github.io/ns/extra" updated="2026-10-26">' +
    '<book id="b1" lang="en"><title>The Pragmatic Programmer</title><author>David Thomas</author><author>Andrew Hunt</author><price currency="USD">42.50</price></book>' +
    '<book id="b2" lang="ar"><title>كليلة ودمنة</title><author>ابن المقفع</author><price currency="JOD">12</price><x:note>Classic &amp; timeless</x:note></book>' +
    '<book id="b3"><title>Clean Code</title><author>Robert Martin</author><price currency="USD">35</price><summary><![CDATA[Use <b>small</b> functions & clear names]]></summary></book>' +
    '<blurb>Prices are <em>estimates</em> only.</blurb></catalog>';

  $$("#view button").forEach(function (b) { b.addEventListener("click", function () { setView(b.dataset.v); }); });
  input.addEventListener("input", S3.debounce(function () { render(); }, 300));
  $("#indent").addEventListener("change", function () { render(); });
  $("#nocom").addEventListener("change", function () { render(); });
  $("#format").addEventListener("click", function () { render("format"); });
  $("#minify").addEventListener("click", function () { render("minify"); });
  $("#clear").addEventListener("click", function () { input.value = ""; render(); input.focus(); });
  $("#sample").addEventListener("click", function () { input.value = SAMPLE; $("#xpath").value = "//d:book[d:price > 30]/d:title"; render("format"); });
  $("#xpath").addEventListener("input", S3.debounce(runXpath, 200));
  $("#xpath").addEventListener("keydown", function (e) { if (e.key === "Enter") runXpath(); });
  $("#run").addEventListener("click", runXpath);
  function load(f) { S3.readFile(f, "text").then(function (t) { input.value = t; render("format"); }); }
  $("#open input").addEventListener("change", function (e) { var f = e.target.files[0]; if (f) load(f); e.target.value = ""; });
  input.addEventListener("dragover", function (e) { e.preventDefault(); });
  input.addEventListener("drop", function (e) { var f = e.dataTransfer.files[0]; if (!f) return; e.preventDefault(); load(f); });
  function current() { return state.view === "json" ? state.json : state.text; }
  $("#copy").addEventListener("click", function () { if (current()) { S3.copy(current()); S3.done(); } else S3.toast("Nothing valid to copy yet", "error"); });
  $("#save").addEventListener("click", function () {
    if (!current()) return S3.toast("Nothing valid to save yet", "error");
    var j = state.view === "json";
    S3.download(current(), j ? "data.json" : "data.xml", j ? "application/json" : "application/xml"); S3.done();
  });

  window.S3_DEMO = function () { $("#sample").click(); setView("text"); };

  window.S3_SELFTEST = function () {
    var fails = [];
    function eq(name, a, b) { a = JSON.stringify(a); b = JSON.stringify(b); if (a !== b) fails.push(name + ": got " + a + " want " + b); }
    eq("valid", parseXml("<a><b/></a>").ok, true);
    var bad = parseXml("<a>\n  <b></a>");
    eq("invalid", bad.ok, false); eq("error line", !!(bad.at && bad.at.line === 2), true);
    eq("two roots invalid", parseXml("<a/><b/>").ok, false);
    eq("undefined entity invalid", parseXml("<a>&nope;</a>").ok, false);
    var src = "<r><a>1</a><b x='1'  y=\"2\"><c/><!--c--></b><d>t <i>x</i> y</d><e><![CDATA[ <not> & tag ]]></e><p xml:space=\"preserve\">  <q> s </q> </p></r>";
    var want = "<r>\n  <a>1</a>\n  <b x='1' y=\"2\">\n    <c/>\n    <!--c-->\n  </b>\n  <d>t <i>x</i> y</d>\n  <e><![CDATA[ <not> & tag ]]></e>\n  <p xml:space=\"preserve\">  <q> s </q> </p>\n</r>";
    eq("pretty", pretty(src, "  ", false), want);
    eq("idempotent", pretty(want, "  ", false), want);
    eq("minify", minify(want, false), "<r><a>1</a><b x='1' y=\"2\"><c/><!--c--></b><d>t <i>x</i> y</d><e><![CDATA[ <not> & tag ]]></e><p xml:space=\"preserve\">  <q> s </q> </p></r>");
    eq("minify stable", minify(pretty(SAMPLE, "\t", false), false), minify(SAMPLE, false));
    eq("pretty sample idempotent", pretty(pretty(SAMPLE, "  ", true), "  ", true), pretty(SAMPLE, "  ", true));
    eq("drop comments", minify("<a><!-- x --><b/></a>", true), "<a><b/></a>");
    eq("same document", ser.serializeToString(parseXml(pretty(SAMPLE, "  ", false)).doc.documentElement.getElementsByTagName("summary")[0]),
      ser.serializeToString(parseXml(SAMPLE).doc.documentElement.getElementsByTagName("summary")[0]));
    var doc = parseXml(SAMPLE).doc;
    eq("xpath count", xpath(doc, "count(//d:book)").value, 3);
    eq("xpath filter", xpath(doc, "//d:book[d:price > 30]/d:title").nodes.map(function (n) { return n.textContent; }), ["The Pragmatic Programmer", "Clean Code"]);
    eq("xpath prefix", xpath(doc, "string(//x:note)").value, "Classic & timeless");
    eq("xpath attr", nodeText(xpath(doc, "//d:book[2]/@lang").nodes[0]), 'lang="ar"');
    var j = xmlToJson(parseXml('<r a="1"><i>x</i><i>y</i><n/><t k="v">txt</t></r>').doc);
    eq("xml→json", j, { r: { "@a": "1", i: ["x", "y"], n: "", t: { "@k": "v", "#text": "txt" } } });
    eq("path", pathOf(doc.getElementsByTagNameNS("*", "title")[1], namespaces(doc)), "/d:catalog/d:book[2]/d:title");
    return fails.length ? fails : true;
  };

  $("#xpath").value = S3.store("xf.xpath") || $("#xpath").value;
  input.value = S3.store("xf.last") || "";
  input.addEventListener("input", S3.debounce(function () { S3.store("xf.last", input.value.length < 200000 ? input.value : undefined); }, 600));
  render();
})();
