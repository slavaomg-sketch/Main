#!/usr/bin/env python3
"""Builds the single-file web version: build/web/index.html (content JSON + sources inlined)."""
import os, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
OUT = os.path.join(ROOT, "build", "web")
os.makedirs(OUT, exist_ok=True)
content = json.load(open(os.path.join(WEB, "content.json"), encoding="utf-8"))
scripts = "\n".join(open(os.path.join(WEB, "src", f), encoding="utf-8").read() for f in sorted(os.listdir(os.path.join(WEB, "src"))) if f.endswith(".js"))
html = open(os.path.join(WEB, "index.template.html"), encoding="utf-8").read()
html = html.replace("/*__CONTENT__*/", json.dumps(content, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"))
html = html.replace("/*__SCRIPTS__*/", scripts.replace("</script>", "<\\/script>"))
open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(html)
print("built", os.path.join(OUT, "index.html"), len(html), "bytes")
