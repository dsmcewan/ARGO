// Controlled external fault injection. No repository code is changed.
import {DatabaseSync} from 'node:sqlite';
import {isMainThread,workerData,parentPort,threadId} from 'node:worker_threads';
import {existsSync,readFileSync,unlinkSync,appendFileSync} from 'node:fs';
if(!isMainThread&&workerData?.binding?.version==='world-conversation/0.1.0'){
 const marker=workerData.path+'.review-fault';
 const control=()=>existsSync(marker)?JSON.parse(readFileSync(marker,'utf8')):null;
 const log=value=>appendFileSync(process.env.ARGO_REVIEW_FAULT_TRACE,JSON.stringify({threadId,...value})+'\n',{mode:0o600});
 const exec=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=function(sql){const active=control();if(sql==='COMMIT'&&active?.mode==='fail_commit'){unlinkSync(marker);log({mode:active.mode,at:'before_COMMIT'});throw Error('Injected COMMIT refusal');}return exec.call(this,sql);};
 const send=parentPort.postMessage.bind(parentPort);
 parentPort.postMessage=function(message,...rest){const active=control();if(active?.mode==='crash_after_commit'&&message?.ok===true&&message.value?.turn_id===active.turn_id){unlinkSync(marker);log({mode:active.mode,at:'after_COMMIT_before_ack',turn_id:active.turn_id});process.exit(77);}return send(message,...rest);};
}
