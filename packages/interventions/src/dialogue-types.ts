import type {CharacterActorQuery} from '@argo/contracts';

/** Ephemeral presentation data; never an authoritative event or a location grant. */
export interface DialogueSupplement {
 version:'character-dialogue/0.1.0';
 query:CharacterActorQuery;
 source:{content_hash:string;revision:string};
 actor:{actor_id:string;name:string;occupation:string;wants:string;will_not:string}|null;
 scene:{location_id:string;name:string;description:string}|null;
}
