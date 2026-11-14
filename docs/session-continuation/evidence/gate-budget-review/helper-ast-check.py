"""Compare sandbox/install/success assertions without importing the candidate helper."""
import argparse,ast,hashlib,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('repo');p.add_argument('base');p.add_argument('candidate');p.add_argument('output');p.add_argument('outer_seconds',type=int);a=p.parse_args()
def blob(sha):return subprocess.check_output(['git','-C',a.repo,'show',sha+':docs/characters-runtime/evidence/run-candidate-gate.py']).decode()
def dump(node):return ast.dump(node,include_attributes=False)
oldtext,newtext=blob(a.base),blob(a.candidate);old,new=ast.parse(oldtext),ast.parse(newtext)
def assign(tree,name):
 rows=[n.value for n in ast.walk(tree) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id==name for t in n.targets)]
 assert len(rows)==1,(name,len(rows));return rows[0]
for name in ['args','install']:
 assert dump(assign(old,name))==dump(assign(new,name)),name+' changed'
oldgate,newgate=assign(old,'gate'),assign(new,'gate');assert isinstance(newgate,ast.Call) and isinstance(oldgate,ast.Call)
assert dump(newgate.func)==dump(oldgate.func) and [dump(x) for x in newgate.args[:3]]==[dump(x) for x in oldgate.args[:3]]
assert len(newgate.args)==4 and isinstance(newgate.args[3],ast.Constant) and newgate.args[3].value==a.outer_seconds
oldasserts=[dump(n.test) for n in ast.walk(old) if isinstance(n,ast.Assert)];newasserts=[dump(n.test) for n in ast.walk(new) if isinstance(n,ast.Assert)]
for assertion in oldasserts:assert assertion in newasserts,'Original success/identity assertion removed: '+assertion
out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
record={'candidate':a.candidate,'sandbox_arguments_ast_identical':True,'offline_install_ast_identical':True,'original_identity_and_ten_group_assertions_preserved':True,'outer_seconds':a.outer_seconds,'helper_sha256':hashlib.sha256(newtext.encode()).hexdigest(),'execution':'AST parsing only. Failure controls and exact final source review remain separate.'}
(out/'helper-ast-check.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
