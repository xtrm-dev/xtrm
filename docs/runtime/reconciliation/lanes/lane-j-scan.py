#!/usr/bin/env python3
"""Lane J: mechanical reference-graph + broken-link extraction. Read-only."""
import os, re, json, hashlib, subprocess
from urllib.parse import unquote

OUT = "/home/dawid/dev/xtrm/docs/runtime/reconciliation/lanes"

SCOPES = [
    ("/home/dawid/dev/xtrm", "docs", ["docs"], {".obsidian", "node_modules"}),
    ("/home/dawid/dev/specialists", "specialists", ["docs"], set()),
    ("/home/dawid/dev/core", "core", ["docs"], {"reference"}),  # third-party copies noted separately
    ("/home/dawid/dev/xtmux", "xtmux", ["docs"], set()),
    ("/home/dawid/dev/xtrm-wt/pr71-loader", "xtrm-wt/pr71-loader", ["experiments"], {"node_modules", ".obsidian"}),
]

def sha_of(path, repo):
    rel = os.path.relpath(path, repo)
    try:
        r = subprocess.run(["git","-C",repo,"rev-parse",f"HEAD:{rel}"],capture_output=True,text=True)
        if r.returncode==0: return r.stdout.strip(), "git-head"
    except Exception: pass
    h=hashlib.sha1(open(path,'rb').read()).hexdigest()
    return h, "blob-untracked"

files=[]  # dicts
excluded=[]
for repo,label,tops,skipdirs in SCOPES:
    for top in tops:
        base=os.path.join(repo,top)
        if not os.path.isdir(base): continue
        for root,dirs,fns in os.walk(base):
            dirs[:]=[d for d in dirs if d not in skipdirs]
            for fn in fns:
                if not fn.endswith(('.md','.json')): continue
                p=os.path.join(root,fn)
                if p.startswith(OUT+'/'): continue  # never scan own lane outputs
                rel=os.path.relpath(p,repo)
                files.append({"id":f"{label}/{rel}","repo":repo,"label":label,"rel":rel,
                              "abs":p,"ext":os.path.splitext(fn)[1]})

# excluded counts (for contract)
refdir="/home/dawid/dev/core/docs/reference"
if os.path.isdir(refdir):
    n=sum(1 for r,d,fns in os.walk(refdir) for fn in fns if fn.endswith(('.md','.json')))
    excluded.append({"path":"core/docs/reference/**","reason":"third-party reference copies (scope instruction)","md_json_count":n})
nm=0; nmroot="/home/dawid/dev/xtrm-wt/pr71-loader/experiments"
for r,d,fns in os.walk(nmroot):
    if 'node_modules' in r.split(os.sep): continue
    d[:]=[x for x in d if x!='node_modules']
for r,d,fns in os.walk(nmroot):
    if 'node_modules' in r.split(os.sep): nm+=sum(1 for fn in fns if fn.endswith(('.md','.json')))
excluded.append({"path":"pr71-loader/experiments/**/node_modules/**","reason":"vendored third-party packages","md_json_count":nm})

LINK_RE=re.compile(r'\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)')
ANGLE_RE=re.compile(r'<([^>]*\.(?:md|json))>')
PATH_RE=re.compile(r'(?<![\w./-])((?:docs|\.agents|skills|src|packages|experiments|scripts|chain-templates|spec)/[\w./@+-]+\.(?:md|json))(?![\w/-])')
REPOS=[("/home/dawid/dev/xtrm","xtrm"),("/home/dawid/dev/specialists","specialists"),
       ("/home/dawid/dev/core","core"),("/home/dawid/dev/xtmux","xtmux"),
       ("/home/dawid/dev/xtrm-wt/pr71-loader","xtrm-wt/pr71-loader")]

def resolve(base_abs, base_repo, target):
    """returns (abs_or_None, status). Bare paths try file-relative THEN repo-root."""
    if target.startswith(('http://','https://','mailto:','#')): return None,'external'
    t=unquote(target.split('#')[0])
    if not t: return None,'anchor-only'
    t=t.rstrip('/')  # dir-style links
    if t.startswith('/'):
        for repo,_ in REPOS:
            c=os.path.join(repo,t.lstrip('/'))
            if os.path.exists(c): return c,'repo-root'
        # also check against the source file's own repo root
        c=os.path.join(base_repo,t.lstrip('/'))
        if os.path.exists(c): return c,'repo-root'
        return None,'abs-missing'
    p=os.path.normpath(os.path.join(os.path.dirname(base_abs),t))
    if os.path.exists(p): return p,'relative'
    # second chance: repo-root-relative intent (docs/foo.md inside a doc)
    if not t.startswith(('./','../')):
        pr=os.path.join(base_repo,t)
        if os.path.exists(pr): return pr,'repo-root-intent'
        # third chance: any other scoped repo root
        for repo,_ in REPOS:
            pr=os.path.join(repo,t)
            if os.path.exists(pr): return pr,'cross-repo-root'
    return None,'relative-missing'

nodes=[]; edges=[]; broken=[]
for f in files:
    try: text=open(f["abs"],encoding='utf-8',errors='replace').read()
    except Exception as e:
        nodes.append({k:f[k] for k in("id","rel","ext")}|{"repo":f["label"],"sha":None,"error":str(e)}); continue
    sha,src=sha_of(f["abs"],f["repo"])
    nodes.append({"id":f["id"],"repo":f["label"],"rel":f["rel"],"ext":f["ext"],"sha":sha,"sha_source":src})
    refs=set()
    for m in LINK_RE.finditer(text):
        refs.add(("mdlink",m.group(1),text.count('\n',0,m.start())+1))
    for m in ANGLE_RE.finditer(text):
        tgt=m.group(1); line=text.count('\n',0,m.start())+1
        if not tgt.startswith('http'): refs.add(("angle",tgt,line))
    for m in PATH_RE.finditer(text):
        refs.add(("pathmention",m.group(1),text.count('\n',0,m.start())+1))
    for kind,tgt,line in sorted(refs):
        r,status=resolve(f["abs"],f["repo"],tgt)
        edges.append({"from":f["id"],"kind":kind,"target_raw":tgt,"line":line,
                      "status":status,"resolved":(os.path.relpath(r,'/') if r else None)})
        if status.endswith('-missing'):
            broken.append({"from":f["id"],"line":line,"kind":kind,"target":tgt,"status":status})

with open(f"{OUT}/lane-j-reference-graph.json","w") as fh:
    json.dump({"nodes":nodes,"edges":edges,"resolved_field":"absolute filesystem path minus leading /"},fh,indent=1)
with open(f"{OUT}/lane-j-broken-links.json","w") as fh:
    json.dump({"broken_relative_and_repo_root_links":broken},fh,indent=1)

print(f"nodes={len(nodes)} edges={len(edges)} broken={len(broken)}")
print(json.dumps(excluded,indent=1))
