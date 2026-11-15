import type {CharacterActorQuery} from '@argo/contracts';
import type {DialogueSupplementV2} from '../../contracts/src/dialogue-knowledge-types.ts';

/** Ephemeral presentation data; never an authoritative event or a location grant. */
export interface DialogueSupplementV1 {
 version:'character-dialogue/0.1.0';
 query:CharacterActorQuery;
 source:{content_hash:string;revision:string};
 actor:{actor_id:string;name:string;occupation:string;wants:string;will_not:string}|null;
 scene:{location_id:string;name:string;description:string}|null;
}

/** Opt-in authored knowledge does not alter the exact legacy field set. */
export type DialogueSupplement = DialogueSupplementV1 | DialogueSupplementV2;
