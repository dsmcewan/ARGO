// Untrusted acceptance/seat processes must not pin the HTTP event loop or outlive a deadline.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export function spawnPromise(cmd, args, {cwd, env, timeout, maxBuffer=64*1024*1024,
  onStdoutLine, signal, killGraceMs=250}={}) {
  return new Promise((resolve,reject)=>{
    signal?.throwIfAborted();
    if(!Number.isSafeInteger(maxBuffer)||maxBuffer<0||!Number.isFinite(killGraceMs)||killGraceMs<0)
      throw new Error('Invalid process bounds');
    const grouped=process.platform!=='win32';
    const child=spawn(cmd,args,{cwd,env,detached:grouped,stdio:['ignore','pipe','pipe']});
    const streams={out:{bytes:0,text:'',decoder:new StringDecoder('utf8')},err:{bytes:0,text:'',decoder:new StringDecoder('utf8')}};
    let pending='',killedFor=null,settled=false,escalation,failsafe,timer;
    const emit=line=>{try{onStdoutLine?.(line);}catch{/* Display hooks never own execution. */}};
    const kill=how=>{
      try{if(grouped&&child.pid)process.kill(-child.pid,how);else child.kill(how);}
      catch{/* The owned process group may already have exited. */}
    };
    const cleanup=()=>{
      clearTimeout(timer);clearTimeout(escalation);clearTimeout(failsafe);
      signal?.removeEventListener('abort',abort);
    };
    const finish=(status,termination)=>{
      if(settled)return;settled=true;cleanup();
      // Don't flush an incomplete UTF-8 tail: replacement bytes can exceed the cap.
      if(pending)emit(pending);
      resolve({status:killedFor?null:status,signal:termination??(killedFor?'SIGKILL':null),
        stdout:streams.out.text,stderr:streams.err.text,killedFor});
    };
    const stop=reason=>{
      if(killedFor||settled)return;killedFor=reason;kill('SIGTERM');
      escalation=setTimeout(()=>{
        kill('SIGKILL');
        // Bound pipe waits too. Bubblewrap separately owns the acceptance process namespace.
        failsafe=setTimeout(()=>{child.stdout.destroy();child.stderr.destroy();finish(null,'SIGKILL');},killGraceMs+50);
      },killGraceMs);
    };
    const abort=()=>stop('cancelled');
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    if(timeout!==undefined){
      if(!Number.isFinite(timeout)||timeout<0)stop('invalid_timeout');
      else timer=setTimeout(()=>stop('timeout'),timeout);
    }
    const collect=kind=>chunk=>{
      if(killedFor)return;
      const state=streams[kind];
      if(state.bytes+chunk.length>maxBuffer){stop('output_limit');return;}
      state.bytes+=chunk.length;
      const text=state.decoder.write(chunk);state.text+=text;
      if(kind==='out'&&onStdoutLine){
        pending+=text;let end;
        while((end=pending.indexOf('\n'))>=0){emit(pending.slice(0,end));pending=pending.slice(end+1);}
      }
    };
    child.stdout.on('data',collect('out'));child.stderr.on('data',collect('err'));
    child.on('error',error=>{if(!settled){settled=true;cleanup();reject(error);}});
    child.on('close',(code,termination)=>{
      if(killedFor)kill('SIGKILL'); // Kill siblings even when the direct child honored TERM.
      finish(code,termination);
    });
  });
}
