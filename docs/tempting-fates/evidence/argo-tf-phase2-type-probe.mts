import type {TabletopState} from '/workspace/ARGO/.worktrees/tempting-fates/docs/tempting-fates/phase2/tabletop-state.ts';
const both: TabletopState['items'][number] = {item_id:'lamp',custodian_actor_id:'pc_a',location_id:'l_harbor',slots:1,destroyed:false};
const neither: TabletopState['items'][number] = {item_id:'lamp',custodian_actor_id:null,location_id:null,slots:1,destroyed:false};
void both; void neither;
