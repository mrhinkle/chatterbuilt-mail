"""Build a personal copy from the template by swapping in a CONFIG block.
usage: python3 mkbuild.py <template.html> <config.js> <out.html>"""
import sys
tpl, cfg, out = sys.argv[1:4]
s = open(tpl).read()
i = s.index("  const CONFIG = {")
j = s.index("  };\n", i) + len("  };\n")
c = open(cfg).read().rstrip() + "\n"
assert c.lstrip().startswith("const CONFIG = {") and c.rstrip().endswith("};")
s = s[:i] + c + s[j:]
open(out, "w").write(s)
print("built", out, len(s))
