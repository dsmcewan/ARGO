import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:true});
try {
 db.exec(`PRAGMA trusted_schema=OFF;
 CREATE TABLE shared_world_v1_events(sequence INTEGER PRIMARY KEY,event_json TEXT);
 CREATE TABLE commit_parent(id INTEGER PRIMARY KEY);
 CREATE TABLE commit_child(parent_id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
 CREATE TRIGGER injected_commit_failure AFTER INSERT ON shared_world_v1_events BEGIN INSERT INTO commit_child(parent_id) VALUES(123); END;
 BEGIN IMMEDIATE;`);
 db.prepare('INSERT INTO shared_world_v1_events(sequence,event_json) VALUES(?,?)').run(1,'candidate event placeholder');
 assert.equal(db.prepare('SELECT count(*) n FROM shared_world_v1_events').get().n,1);
 assert.equal(db.prepare('SELECT count(*) n FROM commit_child').get().n,1);
 let error;try { db.exec('COMMIT'); } catch(e) {error=e;}
 assert.match(error?.message??'',/FOREIGN KEY constraint failed/);
 db.exec('ROLLBACK');assert.equal(db.prepare('SELECT count(*) n FROM shared_world_v1_events').get().n,0);
 console.log(JSON.stringify({insert_succeeded:true,trigger_succeeded:true,commit_failed:error.message,rollback_rows:0,qualification:'Independent SQLite control confirms the exact injected deferred-FK mechanism fails at COMMIT, using foreign_keys enabled and trusted_schema OFF as in the candidate worker.'}));
}finally{db.close();}
