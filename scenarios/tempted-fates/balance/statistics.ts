/** Analysis-only floating point; never sent to resolveMortal or signed events. */
export type Interval={low:number;high:number};
export const Z95=1.959963984540054;
// Four preregistered one-sided target bounds; Bonferroni alpha=.05/4.
export const TARGET_Z=2.241402727604947;
export function wilson(successes:number,n:number,z=Z95):Interval|null{
 if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(successes)||successes<0||successes>n)throw Error('Invalid binomial counts');
 if(n===0)return null;
 const p=successes/n,den=1+z*z/n,mid=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
 return {low:successes===0?0:Math.max(0,mid-half),high:successes===n?1:Math.min(1,mid+half)};
}
export function pairedDifference(treatment:readonly number[],baseline:readonly number[],z=Z95){
 if(treatment.length!==baseline.length||treatment.some(x=>x!==0&&x!==1)||baseline.some(x=>x!==0&&x!==1))throw Error('Invalid paired binary observations');
 const counts={improved:0,worsened:0,both:0,neither:0};
 for(let i=0;i<treatment.length;i++){const a=treatment[i]!,b=baseline[i]!;if(a&&b)counts.both++;else if(a)counts.improved++;else if(b)counts.worsened++;else counts.neither++;}
 const n=treatment.length,mean=n?(counts.improved-counts.worsened)/n:0;
 const variance=n>1?(counts.improved+counts.worsened-n*mean*mean)/(n-1):0;
 const half=n>1?z*Math.sqrt(Math.max(0,variance)/n):1;
 return {count:n,counts,mean,interval:{low:Math.max(-1,mean-half),high:Math.min(1,mean+half)},method:'paired asymptotic normal; seed is the sampling unit'};
}
export function assessTarget(input:{count:number;incapacitated:number;escaped:number;paired:ReturnType<typeof pairedDifference>}){
 const danger=wilson(input.incapacitated,input.count,TARGET_Z),escape=wilson(input.escaped,input.count,TARGET_Z),delta=input.paired.interval;
 if(!danger||!escape||input.count<500)return {status:'inconclusive' as const,danger,escape,delta};
 const match=danger.low>=.20&&danger.high<=.60&&escape.low>=.85&&delta.low>=.15;
 const miss=danger.high<.20||danger.low>.60||escape.high<.85||delta.high<.15;
 return {status:match?'match' as const:miss?'miss' as const:'inconclusive' as const,danger,escape,delta};
}
