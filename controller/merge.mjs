// Execute from a trusted checkout, never from the branch being judged.
import {assertCandidatePolicy,assertSafeStaging,assertExactGitTree} from './policy.ts';
import {protectedPaths as trustedProtectedPaths} from './acceptance-policy.mjs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
const exec=promisify(execFile);
const opts=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,args)=>index%2===0?[...pairs,[value,args[index+1]]]:pairs,[]));
const repository=resolve(opts['--repo']??'.'),candidate=opts['--candidate'],trusted=opts['--trusted'];
if(!/^[a-f0-9]{40}$/.test(candidate??'')||!/^[a-f0-9]{40}$/.test(trusted??'')||process.env.ARGO_CONTROLLER_TRUSTED_SHA!==trusted)
 throw new Error('Supply immutable --candidate/--trusted commits and an externally pinned ARGO_CONTROLLER_TRUSTED_SHA');
if(process.platform!=='linux')throw new Error('Linux Bubblewrap required');
const temporary=await mkdtemp(join(tmpdir(),'argo-controller-'));
const env={PATH:process.env.PATH,HOME:join(temporary,'home'),LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1'};
await mkdir(env.HOME);
const run=async(cmd,args,cwd=repository,binary=false,timeout=240000)=>{
 const r=await exec(cmd,args,{cwd,env,timeout,killSignal:'SIGKILL',maxBuffer:64*1024*1024,...(binary?{encoding:'buffer'}:{encoding:'utf8'})});return r.stdout;
};
const git=args=>run('git',args);
try{
 if((await git(['status','--porcelain'])).trim())throw new Error('Target checkout must be clean');
 const target=(await git(['rev-parse','HEAD'])).trim();
 await git(['merge-base','--is-ancestor',target,candidate]);
 await git(['cat-file','-e',`${trusted}^{commit}`]);
 const source=join(temporary,'candidate'),policy=join(temporary,'policy');await mkdir(source);await mkdir(policy);
 for(const [sha,dest] of [[candidate,source],[trusted,policy]]){
  const archive=join(temporary,`${sha}.tar`);await writeFile(archive,await run('git',['archive','--format=tar',sha],repository,true));await run('tar',['-xf',archive,'-C',dest]);
  await assertExactGitTree(dest,await run('git',['ls-tree','-rz','--full-tree',sha],repository,true));
 }
 await assertSafeStaging(source);
 const protectedPaths=await trustedProtectedPaths(policy,source);
 await assertCandidatePolicy(source,policy,protectedPaths);
 // npm refuses the same config path for two scopes, even /dev/null. Use distinct empty files.
 const userConfig=join(temporary,'user.npmrc'),globalConfig=join(temporary,'global.npmrc');await writeFile(userConfig,'');await writeFile(globalConfig,'');
 const cache=process.env.ARGO_NPM_CACHE;const install=['ci','--ignore-scripts','--no-audit','--no-fund',`--userconfig=${userConfig}`,`--globalconfig=${globalConfig}`,...(cache?['--cache',resolve(cache),'--offline']:[])];
 await run('npm',install,source);
 await run('npm',install,join(source,'pantheon'));
 // Standalone metadata lets the confined gate inspect its staging tree without host Git access.
 await run('git',['init','-q'],source);await run('git',['add','--all'],source);
 await run('git',['-c','user.name=ARGO Controller','-c','user.email=controller@argo.local','commit','-qm','deterministic staging'],source);
 const args=['--unshare-all','--cap-drop','ALL','--die-with-parent','--new-session','--ro-bind','/usr','/usr',
  '--symlink','usr/bin','/bin','--symlink','usr/sbin','/sbin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64',
  '--dir','/tools','--ro-bind',process.execPath,'/tools/node','--proc','/proc','--dev','/dev','--tmpfs','/tmp',
  '--ro-bind',source,'/workspace','--chdir','/workspace','--clearenv','--setenv','PATH','/tools:/usr/bin:/bin','--setenv','HOME','/tmp','--setenv','LANG','C.UTF-8'];
 for(const path of protectedPaths)args.push('--ro-bind',join(source,path),'/workspace/'+path);
 args.push('--','/tools/node','scripts/gate.mjs','--merge-ready');
 process.stdout.write(await run('/usr/bin/bwrap',args,source,false,600000));
 if((await git(['rev-parse','HEAD'])).trim()!==target||(await git(['status','--porcelain'])).trim())throw new Error('Target changed while candidate was being checked');
 await git(['merge','--ff-only','--no-overwrite-ignore',candidate]);
 console.log(`Merged tested candidate ${candidate} using trusted policy ${trusted}`);
}finally{await rm(temporary,{recursive:true,force:true});}
