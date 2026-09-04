#!/usr/bin/env python3
"""Type-check the Rojo source tree with luau-analyze.

Roblox-style requires (`require(script.Parent.X)`, `require(game:GetService("ReplicatedStorage").Shared.X)`) are
rewritten into string requires in a shadow copy so the analyzer can resolve cross-module types. The real sources
are never modified. Usage: python3 tools/analyze.py [--strict-only]
"""
import os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
OUT = os.path.join(ROOT, "build", "analyze")
DEFS = os.path.join(ROOT, "tools", "globalTypes.d.luau")

ROOTS = {
    "ReplicatedStorage/Shared": "Shared",
    "ServerScriptService/Server": "Server",
    "StarterPlayer/StarterPlayerScripts/Client": "Client",
    "ServerStorage/Content": "Content",
}

SERVICE_RE = re.compile(r'game:GetService\("(ReplicatedStorage|ServerScriptService|ServerStorage|StarterPlayer)"\)')
REQ_RE = re.compile(r'require\(([^()"]+?)\)')

def logical_path(abs_path):
    rel = os.path.relpath(abs_path, SRC).replace(os.sep, "/")
    for prefix, alias in ROOTS.items():
        if rel.startswith(prefix + "/"):
            return alias + "/" + rel[len(prefix) + 1:]
    return rel

def resolve(expr, module_logical):
    """Turn an instance-path expression into a shadow-tree relative string path."""
    expr = expr.strip()
    expr = SERVICE_RE.sub(lambda m: m.group(1), expr)
    parts = [p for p in re.split(r"[.:]", expr) if p]
    parts = [p.replace("WaitForChild(", "").replace(")", "").strip('"') for p in parts]
    cur = module_logical.split("/")  # e.g. Shared/Config/GameConfig
    cur = cur[:-1] + [cur[-1]]
    # position: module itself
    stack = list(cur)
    i = 0
    if parts[0] == "script":
        i = 1
    elif parts[0] in ("Shared", "Server", "Client", "Content"):
        stack = [parts[0]]
        i = 1
    elif parts[0] in ("ReplicatedStorage", "ServerScriptService", "ServerStorage", "StarterPlayer"):
        # ReplicatedStorage.Shared.X -> Shared/X
        mapping = {"ReplicatedStorage": ["Shared"], "ServerScriptService": ["Server"], "ServerStorage": ["Content"], "StarterPlayer": ["StarterPlayerScripts", "Client"]}
        j = 1
        for expected in mapping[parts[0]]:
            if j < len(parts) and parts[j] == expected:
                j += 1
        stack = [mapping[parts[0]][-1]]
        i = j
    else:
        return None
    for p in parts[i:]:
        if p == "Parent":
            stack.pop()
        else:
            stack.append(p)
    target = "/".join(stack)
    # compute relative path from module dir
    mod_dir = "/".join(module_logical.split("/")[:-1])
    rel = os.path.relpath(target, mod_dir).replace(os.sep, "/")
    if not rel.startswith("."):
        rel = "./" + rel
    return rel

def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    files = []
    for dirpath, _, names in os.walk(SRC):
        for n in names:
            if n.endswith(".luau"):
                files.append(os.path.join(dirpath, n))
    logical_set = {}
    for f in files:
        lp = logical_path(f)
        lp = re.sub(r"\.(server|client)\.luau$", ".luau", lp)
        logical_set[f] = lp[:-5] if lp.endswith(".luau") else lp
    unresolved = []
    for f, lp in logical_set.items():
        src = open(f, encoding="utf-8").read()
        def sub(m):
            r = resolve(m.group(1), lp)
            if r is None:
                unresolved.append((lp, m.group(1)))
                return m.group(0)
            return 'require("%s")' % r
        out = REQ_RE.sub(sub, src)
        # Roblox-only sugar the plain analyzer cannot resolve without a sourcemap:
        out = re.sub(r'game:GetService\("(\w+)"\)', r'(game:GetService("\1") :: \1)', out)
        out = re.sub(r'\bEnum\.(\w+)(?![\w.:])', r'Enum\1', out)
        out = re.sub(r'Instance\.new\("(\w+)"\)', r'(Instance.new("\1") :: \1)', out)
        out = re.sub(r'\b(ReplicatedStorage|ServerScriptService|ServerStorage|StarterGui|StarterPlayer|Workspace)\.(Shared|Server|Content|RiftRacersUI|StarterPlayerScripts|RiftRacers)\b', r'(\1 :: any).\2', out)
        dest = os.path.join(OUT, lp + ".luau")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, "w", encoding="utf-8").write(out)
    shutil.copy(os.path.join(ROOT, ".luaurc"), os.path.join(OUT, ".luaurc"))
    for lp, expr in unresolved:
        print("unresolved require in %s: %s" % (lp, expr))
    targets = sorted(os.path.join(OUT, lp + ".luau") for lp in logical_set.values())
    cmd = ["luau-analyze", "--fflags=LuauSolverV2=false,LuauTarjanChildLimit=100000,LuauTypeInferIterationLimit=1000000,LuauTypeInferRecursionLimit=1000,LuauTypeCloneIterationLimit=10000000,LuauSolverConstraintLimit=100000,LuauSolverRecursionLimit=5000,LuauCheckRecursionLimit=3000", "--defs=" + DEFS, "--mode=strict"] + targets
    proc = subprocess.run(cmd, cwd=OUT, capture_output=True, text=True)
    text = proc.stdout + proc.stderr
    text = text.replace(OUT + "/", "").replace("./", "")
    text = "\n".join(l for l in text.splitlines() if not re.search(r"LocalUnused: Variable '(Shared|Server|Client|Content)'", l))
    lines = [l for l in text.splitlines() if "Error" in l or "Warning" in l]
    print(text.strip())
    print("\n%d diagnostics" % len(lines))
    sys.exit(1 if proc.returncode != 0 else 0)

if __name__ == "__main__":
    main()
