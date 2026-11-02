"""Build a personal copy from the template by swapping in a CONFIG block.
usage: python3 scripts/build.py <template.html> <config.js> <out.html>

It also stamps the version from .claude-plugin/plugin.json into the page, so the
app can show it (Settings → Skills) and bug reports can name it."""
import json, os, sys
tpl, cfg, out = sys.argv[1:4]
s = open(tpl).read()
i = s.index("  const CONFIG = {")
j = s.index("  };\n", i) + len("  };\n")
c = open(cfg).read().rstrip() + "\n"
assert c.lstrip().startswith("const CONFIG = {") and c.rstrip().endswith("};")
s = s[:i] + c + s[j:]

def find_version(start):
    d = os.path.dirname(os.path.abspath(start))
    for _ in range(6):
        p = os.path.join(d, ".claude-plugin", "plugin.json")
        if os.path.exists(p):
            try:
                return str(json.load(open(p)).get("version") or "")
            except Exception:
                return ""
        d = os.path.dirname(d)
    return ""

version = find_version(tpl)
if version:
    s = s.replace('const APP_VERSION = "dev";', 'const APP_VERSION = "' + version + '";', 1)
open(out, "w").write(s)
print("built", out, len(s), "version " + (version or "dev"))
