/** Analysis-only floating point; never sent to resolveMortal or signed events. */
export type Interval={low:number;high:number};
export const Z95=1.959963984540054;
// Four preregistered one-sided target bounds; Bonferroni alpha=.05/4.
export const TARGET_Z=2.241402727604947;
// The paired target lower bound spends its .0125 budget on two marginal tails.
export const PAIRED_TARGET_Z=2.497705474412373;
export function wilson(successes:number,n:number,z=Z95):Interval|null{
 if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(successes)||successes<0||successes>n||!Number.isFinite(z)||z<=0)throw Error('Invalid binomial counts or quantile');
 if(n===0)return null;
 const p=successes/n,den=1+z*z/n,mid=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
 return {low:successes===0?0:Math.max(0,mid-half),high:successes===n?1:Math.min(1,mid+half)};
}
export function pairedDifference(treatment:readonly number[],baseline:readonly number[],purpose:'descriptive'|'target'='descriptive'){
 if(!['descriptive','target'].includes(purpose)||treatment.length!==baseline.length||treatment.some(x=>x!==0&&x!==1)||baseline.some(x=>x!==0&&x!==1))throw Error('Invalid paired binary observations');
 const counts={improved:0,worsened:0,both:0,neither:0};
 for(let i=0;i<treatment.length;i++){const a=treatment[i]!,b=baseline[i]!;if(a&&b)counts.both++;else if(a)counts.improved++;else if(b)counts.worsened++;else counts.neither++;}
 const n=treatment.length,mean=n?(counts.improved-counts.worsened)/n:0;
 // p(improved) and p(worsened) are binomial marginals of the paired multinomial.
 // Union bounds require no independence. Score coverage is nominal, not exact.
 // Descriptive: four tails * .0125 = .05. Target lower: two tails * .00625 = .0125.
 const z=purpose==='target'?PAIRED_TARGET_Z:TARGET_Z;
 const improved=wilson(counts.improved,n,z),worsened=wilson(counts.worsened,n,z);
 const interval:Interval=improved&&worsened?{low:Math.max(-1,improved.low-worsened.high),high:Math.min(1,improved.high-worsened.low)}:{low:-1,high:1};
 return {count:n,counts,mean,interval,marginal_intervals:{improved,worsened},marginal_one_sided_alpha:purpose==='target'?.00625:.0125,
  method:'union-bounded Wilson score marginals for p(improved)-p(worsened); nominal score coverage, not an exact finite-sample guarantee'};
}
export function assessTarget(input:{count:number;incapacitated:number;escaped:number;censoredPairs:number;paired:ReturnType<typeof pairedDifference>|null}){
 if(!Number.isSafeInteger(input.censoredPairs)||input.censoredPairs<0||input.censoredPairs>input.count)throw Error('Invalid censorship count');
 const danger=wilson(input.incapacitated,input.count,TARGET_Z),escape=wilson(input.escaped,input.count,TARGET_Z);
 // Terminal survival is unknown for any unresolved pair; do not code it as0.
 if(input.censoredPairs>0)return {status:'inconclusive' as const,reason:'censored-comparison',censored_pairs:input.censoredPairs,danger:null,escape:null,delta:null};
 if(!input.paired||input.paired.count!==input.count)throw Error('Target requires matching uncensored paired observations');
 const delta=input.paired.interval;
 if(!danger||!escape||input.count<500)return {status:'inconclusive' as const,reason:'insufficient-study',censored_pairs:0,danger,escape,delta};
 const match=danger.low>=.20&&danger.high<=.60&&escape.low>=.85&&delta.low>=.15;
 const miss=danger.high<.20||danger.low>.60||escape.high<.85||delta.high<.15;
 return {status:match?'match' as const:miss?'miss' as const:'inconclusive' as const,reason:match?'target-bounds-match':miss?'target-bounds-miss':'target-boundary-overlap',censored_pairs:0,danger,escape,delta};
}
