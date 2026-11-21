#!/usr/bin/env python3
"""Durable local provider admission. No SDK, network or credential loader.

All callers are trusted coordinator/transport processes under the private DB owner.
Only explicit initialize() creates state. Paid outcomes require verified transport
usage or an external reconciliation verifier; elapsed time never releases them.
"""
import argparse
from contextlib import closing, contextmanager
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parent))

DIMENSIONS=('requests','input_tokens','output_tokens','spend_microusd')
MAX=2**53-1
ID=re.compile(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}\Z')
HEX=re.compile(r'[a-f0-9]{64}\Z')
SCHEMA='''CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE pools (id TEXT PRIMARY KEY, retry_at_ms INTEGER NOT NULL, auth_ok INTEGER NOT NULL, quarantined INTEGER NOT NULL);
CREATE TABLE reservations (key TEXT PRIMARY KEY, pool TEXT NOT NULL REFERENCES pools(id), binding_sha256 TEXT NOT NULL, binding TEXT NOT NULL, requested TEXT NOT NULL, charged TEXT NOT NULL, status TEXT NOT NULL, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, dispatched_ms INTEGER, settled_ms INTEGER, owner TEXT, epoch INTEGER NOT NULL, token_sha256 TEXT, lease_until_ms INTEGER, evidence_sha256 TEXT);
CREATE TABLE lineages (key TEXT PRIMARY KEY, binding_sha256 TEXT NOT NULL, epoch INTEGER NOT NULL, token_sha256 TEXT, status TEXT NOT NULL, attempt TEXT NOT NULL, outcome TEXT, updated_ms INTEGER NOT NULL);
CREATE TABLE audit (seq INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, event TEXT NOT NULL, reservation_key TEXT, payload TEXT NOT NULL, prior_hash TEXT, hash TEXT NOT NULL);'''
POLICY_TABLE='CREATE TABLE budget_policies (epoch INTEGER PRIMARY KEY, policy_sha TEXT NOT NULL UNIQUE, grant_json TEXT NOT NULL, adopted_ms INTEGER NOT NULL, audit_seq INTEGER NOT NULL, audit_hash TEXT NOT NULL);'
POLICY_INTENTS='CREATE TABLE budget_intents (epoch INTEGER PRIMARY KEY, policy_sha TEXT NOT NULL UNIQUE, profile_sha TEXT NOT NULL, grant_json TEXT NOT NULL, verified_ms INTEGER NOT NULL);'


class AdmissionError(ValueError):pass


def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
def digest(value):return hashlib.sha256(canonical(value).encode()).hexdigest()
def integer(value):
    if type(value) is not int or not 0<=value<=MAX:raise AdmissionError('Expected nonnegative safe integer')
    return value

def identifier(value):
    if not isinstance(value,str) or not ID.fullmatch(value):raise AdmissionError('Invalid bounded identity')
    return value

def quantities(value):
    if not isinstance(value,dict) or set(value)!=set(DIMENSIONS):raise AdmissionError('Exactly four resource dimensions required')
    return {d:integer(value[d]) for d in DIMENSIONS}

def profile(value,pool=False):
    keys={'lifetime','windows'}|({'credential_ref','models'} if pool else set())
    if not isinstance(value,dict) or set(value)!=keys:raise AdmissionError('Invalid quota profile fields')
    quantities(value['lifetime'])
    if not isinstance(value['windows'],list) or len(value['windows'])>16:raise AdmissionError('Bounded quota windows required')
    windows=[]
    for w in value['windows']:
        if not isinstance(w,dict) or set(w)!={'milliseconds','limits'} or not 1<=integer(w['milliseconds'])<=31_536_000_000:raise AdmissionError('Invalid quota window')
        quantities(w['limits']);windows.append(w['milliseconds'])
    if len(windows)!=len(set(windows)):raise AdmissionError('Duplicate quota window')
    if pool:
        identifier(value['credential_ref'])
        if not isinstance(value['models'],list) or not 1<=len(value['models'])<=100 or len(set(value['models']))!=len(value['models']):raise AdmissionError('Explicit unique model allowlist required')
        for model in value['models']:identifier(model)

def configuration(value):
    if not isinstance(value,dict) or set(value)!={'schema_version','global','pools'} or type(value['schema_version']) is not int or value['schema_version']!=1:raise AdmissionError('Unsupported broker configuration')
    profile(value['global'])
    if not isinstance(value['pools'],dict) or not 1<=len(value['pools'])<=100:raise AdmissionError('Configured pools required')
    for name,p in value['pools'].items():identifier(name);profile(p,True)
    return json.loads(canonical(value))

def schema_digest(db):return digest(db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall())
with closing(sqlite3.connect(':memory:')) as _model:
    _model.executescript(SCHEMA);EXPECTED_SCHEMA=schema_digest(_model)
    _model.execute(POLICY_TABLE);_model.execute(POLICY_INTENTS);POLICY_SCHEMA=schema_digest(_model)

def private_file(path):
    path=Path(path).absolute()
    for parent in (path,*path.parents):
        if parent.is_symlink():raise AdmissionError('Broker path must not contain symlinks')
    st=path.stat()
    if not stat.S_ISREG(st.st_mode) or st.st_mode&0o077:raise AdmissionError('Broker database must be a private regular file (0600)')
    return path

def initialize(path,config):
    config=configuration(config);path=Path(path).absolute()
    for parent in path.parents:
        if parent.is_symlink():raise AdmissionError('Broker path must not contain symlinks')
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
    identity=secrets.token_hex(16)
    try:
        with closing(sqlite3.connect(path)) as db:
            db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA synchronous=FULL');db.executescript(SCHEMA)
            db.executemany('INSERT INTO meta VALUES (?,?)',[('schema','1'),('config',canonical(config)),('config_sha',digest(config)),('database_id',identity),('last_ms','0')])
            db.executemany('INSERT INTO pools VALUES (?,0,1,0)',[(p,) for p in config['pools']])
            db.commit()
    except BaseException:
        # Preserve failed initialization for inspection; it must never become a
        # new empty budget simply because a worker tried opening it again.
        raise
    return identity


class Broker:
    def __init__(self,path,config,database_id,*,clock=None,budget_policy=None):
        self.path=private_file(path);self.config=configuration(config)
        if not isinstance(database_id,str) or not re.fullmatch(r'[a-f0-9]{32}',database_id):raise AdmissionError('Externally retained database identity required')
        self.database_id=database_id;self.clock=clock or (lambda:time.time_ns()//1_000_000)
        self.budget_policy=None
        if budget_policy is not None:
            from budget_policy import PolicyContext
            self.budget_policy=PolicyContext(budget_policy,self.path,self.config,self.database_id)
        with self.transaction(read_only=True) as db:self._check(db)

    def _check(self,db,*,adoption=False):
        if db.execute('PRAGMA quick_check').fetchall()!=[('ok',)]:raise AdmissionError('Broker integrity check refused')
        if db.execute('PRAGMA foreign_key_check').fetchall():raise AdmissionError('Broker foreign key corruption')
        schema=schema_digest(db)
        if schema not in ((EXPECTED_SCHEMA,POLICY_SCHEMA) if adoption else (POLICY_SCHEMA,) if self.budget_policy else (EXPECTED_SCHEMA,)):raise AdmissionError('Broker schema drift')
        meta=dict(db.execute('SELECT key,value FROM meta'))
        if set(meta)!={'schema','config','config_sha','database_id','last_ms'} or meta['schema']!=('2' if schema==POLICY_SCHEMA else '1') or meta['database_id']!=self.database_id or meta['config']!=canonical(self.config) or meta['config_sha']!=digest(self.config):raise AdmissionError('Broker identity/configuration mismatch')
        if not meta['last_ms'].isdigit():raise AdmissionError('Invalid durable clock')
        integer(int(meta['last_ms']))
        if {r[0] for r in db.execute('SELECT id FROM pools')}!=set(self.config['pools']):raise AdmissionError('Pool inventory drift')
        for retry_at,auth,quarantined in db.execute('SELECT retry_at_ms,auth_ok,quarantined FROM pools'):
            integer(retry_at)
            if auth not in (0,1) or quarantined not in (0,1):raise AdmissionError('Invalid pool state')
        for status,requested,charged,binding,bound_sha,epoch in db.execute('SELECT status,requested,charged,binding,binding_sha256,epoch FROM reservations'):
            if status not in ('reserved','dispatched','unknown','settled','cancelled','quarantined'):raise AdmissionError('Invalid reservation state')
            quantities(json.loads(requested));quantities(json.loads(charged));integer(epoch)
            if digest(json.loads(binding))!=bound_sha:raise AdmissionError('Corrupt reservation identity')
        for status,epoch,token,attempt,outcome in db.execute('SELECT status,epoch,token_sha256,attempt,outcome FROM lineages'):
            if status not in ('held','confirmed') or integer(epoch)<1 or (status=='held')!=(token is not None):raise AdmissionError('Invalid lineage state')
            if not isinstance(json.loads(attempt),dict) or (outcome is not None and not isinstance(json.loads(outcome),dict)):raise AdmissionError('Invalid lineage record')
        if self.budget_policy and not adoption:self.budget_policy.check(db)

    @contextmanager
    def transaction(self,*,read_only=False):
        from contextlib import nullcontext
        with self.budget_policy.lock() if self.budget_policy else nullcontext():
            with self._transaction(read_only=read_only) as db:yield db

    @contextmanager
    def _transaction(self,*,read_only=False):
        private_file(self.path)
        db=sqlite3.connect(self.path.as_uri()+('?mode=ro' if read_only else '?mode=rw'),uri=True,isolation_level=None,timeout=15)
        try:
            db.execute('PRAGMA foreign_keys=ON');db.execute('PRAGMA synchronous=FULL')
            if read_only:db.execute('PRAGMA query_only=ON')
            db.execute('BEGIN' if read_only else 'BEGIN IMMEDIATE')
            self._check(db)
            yield db
            db.commit()
        except BaseException:db.rollback();raise
        finally:db.close()

    def _now(self,db):
        now=integer(self.clock());last=int(db.execute("SELECT value FROM meta WHERE key='last_ms'").fetchone()[0])
        if now<last:raise AdmissionError('Clock moved backwards; reconcile trusted clock before admission')
        db.execute("UPDATE meta SET value=? WHERE key='last_ms'",(str(now),));return now

    def _event(self,db,now,event,key,payload):
        prev=db.execute('SELECT seq,hash FROM audit ORDER BY seq DESC LIMIT 1').fetchone()
        seq=prev[0]+1 if prev else 1;prior=prev[1] if prev else None
        record={'seq':seq,'at_ms':now,'event':event,'reservation_key':key,'payload':payload,'prior_hash':prior}
        db.execute('INSERT INTO audit VALUES (?,?,?,?,?,?,?)',(seq,now,event,key,canonical(payload),prior,digest(record)))

    def _row(self,db,key):
        identifier(key);db.row_factory=sqlite3.Row
        row=db.execute('SELECT * FROM reservations WHERE key=?',(key,)).fetchone();db.row_factory=None
        if row is None:raise AdmissionError('Unknown reservation')
        return dict(row)

    @staticmethod
    def public(row):
        return {k:(json.loads(v) if k in ('binding','requested','charged') else v) for k,v in row.items() if k!='token_sha256'}

    def _pool(self,db,pool):
        identifier(pool)
        row=db.execute('SELECT retry_at_ms,auth_ok,quarantined FROM pools WHERE id=?',(pool,)).fetchone()
        if row is None:raise AdmissionError('Unknown pool')
        return row

    def _admit(self,db,pool,now):
        if self.budget_policy and now>=self.budget_policy.expires_ms:return 'budget_policy_expired'
        until,auth,quarantined=self._pool(db,pool)
        if quarantined:return 'quarantined'
        if not auth:return 'auth_required'
        if now<until:return 'cooldown'
        return None

    def _expire(self,db,now):
        recovered=[];cancelled=[]
        for key,status in db.execute("SELECT key,status FROM reservations WHERE (status='reserved' AND expires_ms<=?) OR (status='dispatched' AND lease_until_ms<=?)",(now,now)).fetchall():
            new='cancelled' if status=='reserved' else 'unknown'
            if new=='cancelled':
                db.execute('UPDATE reservations SET status=?,charged=?,epoch=epoch+1 WHERE key=?',(new,canonical(dict.fromkeys(DIMENSIONS,0)),key));cancelled.append(key)
            else:
                db.execute('UPDATE reservations SET status=?,owner=NULL,token_sha256=NULL,lease_until_ms=NULL,epoch=epoch+1 WHERE key=?',(new,key));recovered.append(key)
            self._event(db,now,'EXPIRED_'+new.upper(),key,{})
        return {'recovered':recovered,'cancelled':cancelled}

    def _usage(self,db,pool=None,now=0,window=None):
        spent=dict.fromkeys(DIMENSIONS,0);held=dict.fromkeys(DIMENSIONS,0)
        sql='SELECT status,charged,dispatched_ms,created_ms FROM reservations'+(' WHERE pool=?' if pool else '')
        for status,charge,dispatched,created in db.execute(sql,(pool,) if pool else ()):
            if status=='cancelled':continue
            if status=='settled' and window is not None and (dispatched if dispatched is not None else created)<=now-window:continue
            dest=spent if status=='settled' else held
            for d,n in quantities(json.loads(charge)).items():dest[d]=integer(dest[d]+n)
        return {'spent':spent,'held':held,'total':{d:integer(spent[d]+held[d]) for d in DIMENSIONS}}

    def _budget(self,db,pool,requested,now):
        ceilings=self.budget_policy.ceilings if self.budget_policy else self.config
        for scope,limits in ((None,ceilings['global']),(pool,ceilings['pools'][pool])):
            for window,ceiling in [(None,limits['lifetime']),*((w['milliseconds'],w['limits']) for w in limits['windows'])]:
                usage=self._usage(db,scope,now,window)['total']
                if any(usage[d]+requested[d]>ceiling[d] for d in DIMENSIONS):return False
        return True

    def reserve(self,pool,key,requested,binding,*,ttl_ms=60000):
        identifier(pool);identifier(key);requested=quantities(requested)
        if requested['requests']<1 or not 1<=integer(ttl_ms)<=3_600_000:raise AdmissionError('Positive request count and bounded reservation TTL required')
        if not isinstance(binding,dict) or set(binding)!={'task_sha256','request_sha256','source_sha256','model','credential_ref'}:raise AdmissionError('Complete task/request/source/model/credential binding required')
        for keyname in ('task_sha256','request_sha256','source_sha256'):
            if not isinstance(binding[keyname],str) or not HEX.fullmatch(binding[keyname]):raise AdmissionError('Full immutable source/request identities required')
        identifier(binding['model']);identifier(binding['credential_ref'])
        if pool not in self.config['pools'] or binding['model'] not in self.config['pools'][pool]['models'] or binding['credential_ref']!=self.config['pools'][pool]['credential_ref']:raise AdmissionError('Request differs from configured pool/model/credential authority')
        bound={'pool':pool,'config_sha256':digest(self.config),**binding};bound_sha=digest(bound)
        with self.transaction() as db:
            now=self._now(db);self._expire(db,now)
            existing=db.execute('SELECT key FROM reservations WHERE key=?',(key,)).fetchone()
            if existing:
                row=self._row(db,key)
                if row['binding_sha256']!=bound_sha or row['requested']!=canonical(requested):raise AdmissionError('Idempotency key already binds different request, source, task or quota')
                return self.public(row)
            refusal=self._admit(db,pool,now)
            if refusal:return {'status':refusal}
            if not self._budget(db,pool,requested,now):return {'status':'budget_refused'}
            expires=integer(now+ttl_ms)
            db.execute('INSERT INTO reservations (key,pool,binding_sha256,binding,requested,charged,status,created_ms,expires_ms,epoch) VALUES (?,?,?,?,?,?,?,?,?,0)',(key,pool,bound_sha,canonical(bound),canonical(requested),canonical(requested),'reserved',now,expires))
            self._event(db,now,'RESERVED',key,{'binding_sha256':bound_sha,'requested':requested,**({'budget_policy':self.budget_policy.identity} if self.budget_policy else {})})
            return self.public(self._row(db,key))

    def claim_dispatch(self,key,owner,*,lease_ms=60000):
        identifier(owner)
        if not 1<=integer(lease_ms)<=3_600_000:raise AdmissionError('Bounded dispatch lease required')
        with self.transaction() as db:
            now=self._now(db);self._expire(db,now);row=self._row(db,key)
            if row['status']!='reserved':return {'status':'dispatch_refused'}
            if self.budget_policy:
                policy=db.execute("SELECT payload FROM audit WHERE event='RESERVED' AND reservation_key=? ORDER BY seq DESC LIMIT 1",(key,)).fetchone()
                if not policy or json.loads(policy[0]).get('budget_policy')!=self.budget_policy.identity:return {'status':'budget_policy_changed'}
            refusal=self._admit(db,row['pool'],now)
            if refusal:return {'status':refusal}
            token=secrets.token_hex(32);epoch=row['epoch']+1
            db.execute("UPDATE reservations SET status='dispatched',dispatched_ms=?,owner=?,epoch=?,token_sha256=?,lease_until_ms=? WHERE key=?",(now,owner,epoch,hashlib.sha256(token.encode()).hexdigest(),integer(now+lease_ms),key))
            self._event(db,now,'DISPATCH_INTENT',key,{'owner':owner,'epoch':epoch})
            return {**self.public(self._row(db,key)),'token':token}

    def _fence(self,row,fence,now,*,allow_expired=False):
        if not isinstance(fence,dict) or fence.get('owner')!=row['owner'] or fence.get('epoch')!=row['epoch'] or not isinstance(fence.get('token'),str) or not row['token_sha256'] or not hmac.compare_digest(hashlib.sha256(fence['token'].encode()).hexdigest(),row['token_sha256']):raise AdmissionError('Dispatch owner or fencing epoch changed')
        if not allow_expired and (row['lease_until_ms'] is None or now>=row['lease_until_ms']):raise AdmissionError('Dispatch lease expired')

    def heartbeat(self,key,fence,*,lease_ms=60000):
        if not 1<=integer(lease_ms)<=3_600_000:raise AdmissionError('Bounded dispatch lease required')
        with self.transaction() as db:
            now=self._now(db);row=self._row(db,key);self._fence(row,fence,now)
            if row['status']!='dispatched':raise AdmissionError('Only dispatched owner can heartbeat')
            db.execute('UPDATE reservations SET lease_until_ms=? WHERE key=?',(integer(now+lease_ms),key));self._event(db,now,'HEARTBEAT',key,{'epoch':row['epoch']})
            return self.public(self._row(db,key))

    def settle(self,key,fence,actual):
        actual=quantities(actual)
        with self.transaction() as db:
            now=self._now(db);row=self._row(db,key);self._fence(row,fence,now,allow_expired=row['status']=='settled')
            if row['status']=='settled':
                if row['charged']!=canonical(actual):raise AdmissionError('Conflicting repeat settlement')
                return self.public(row)
            if row['status']!='dispatched':raise AdmissionError('Uncertain outcome requires external reconciliation')
            requested=json.loads(row['requested']);overrun=any(actual[d]>requested[d] for d in DIMENSIONS)
            status='quarantined' if overrun else 'settled';charged={d:max(actual[d],requested[d]) for d in DIMENSIONS} if overrun else actual
            db.execute('UPDATE reservations SET status=?,charged=?,settled_ms=? WHERE key=?',(status,canonical(charged),now,key))
            if overrun:db.execute('UPDATE pools SET quarantined=1 WHERE id=?',(row['pool'],))
            self._event(db,now,'USAGE_'+status.upper(),key,{'actual':actual,'charged':charged})
            return self.public(self._row(db,key))

    def mark_unknown(self,key,fence):
        with self.transaction() as db:
            now=self._now(db);row=self._row(db,key)
            if row['status']=='unknown':return self.public(row)
            self._fence(row,fence,now,allow_expired=True)
            if row['status']!='dispatched':raise AdmissionError('Only dispatched outcome can become unknown')
            db.execute("UPDATE reservations SET status='unknown',owner=NULL,token_sha256=NULL,lease_until_ms=NULL,epoch=epoch+1 WHERE key=?",(key,))
            self._event(db,now,'OUTCOME_UNKNOWN',key,{});return self.public(self._row(db,key))

    def cancel(self,key,fence=None):
        with self.transaction() as db:
            now=self._now(db);row=self._row(db,key)
            if row['status']=='reserved':
                db.execute("UPDATE reservations SET status='cancelled',charged=?,epoch=epoch+1 WHERE key=?",(canonical(dict.fromkeys(DIMENSIONS,0)),key))
            elif row['status']=='dispatched':
                self._fence(row,fence,now,allow_expired=True)
                db.execute("UPDATE reservations SET status='unknown',owner=NULL,token_sha256=NULL,lease_until_ms=NULL,epoch=epoch+1 WHERE key=?",(key,))
            else:return self.public(row)
            self._event(db,now,'CANCELLED',key,{'previous_status':row['status']});return self.public(self._row(db,key))

    def refuse(self,pool,*,retry_at_ms):
        integer(retry_at_ms)
        with self.transaction() as db:
            now=self._now(db);self._pool(db,pool);db.execute('UPDATE pools SET retry_at_ms=MAX(retry_at_ms,?) WHERE id=?',(retry_at_ms,pool));self._event(db,now,'POOL_COOLDOWN',None,{'pool':pool,'retry_at_ms':retry_at_ms})
        return {'status':'cooldown','retry_at_ms':retry_at_ms}

    def auth_expired(self,pool):
        with self.transaction() as db:
            now=self._now(db);self._pool(db,pool);db.execute('UPDATE pools SET auth_ok=0 WHERE id=?',(pool,));self._event(db,now,'AUTH_EXPIRED',None,{'pool':pool})
        return {'status':'auth_required'}

    def _credential_challenge(self,db,pool):
        self._pool(db,pool)
        expired=None
        for seq,at,payload in db.execute("SELECT seq,at_ms,payload FROM audit WHERE event='AUTH_EXPIRED' ORDER BY seq DESC"):
            if json.loads(payload).get('pool')==pool:
                expired=(seq,at);break
        if expired is None:raise AdmissionError('No authentication failure to reconcile')
        return {'database_id':self.database_id,'config_sha256':digest(self.config),'pool':pool,
                'credential_ref':self.config['pools'][pool]['credential_ref'],
                'auth_event_seq':expired[0],'auth_failed_at_ms':expired[1]}

    def credential_challenge(self,pool):
        with self.transaction() as db:return self._credential_challenge(db,pool)

    def recover_credential(self,pool,evidence,verify):
        """Authenticate one current pool-health observation; never clear paid holds.

        No arbitrary authenticated:true CLI exists. The verifier must belong to
        the coordinator and bind the configured account, credential reference,
        exact durable failure event, DB/config, trusted time and observation.
        """
        fields={'database_id','config_sha256','pool','credential_ref','auth_event_seq',
                'auth_failed_at_ms','observed_at_ms','expires_at_ms','evidence_sha256'}
        if not callable(verify) or not isinstance(evidence,dict) or set(evidence)!=fields:raise AdmissionError('Bound credential-health evidence required')
        evidence=json.loads(canonical(evidence));proof=verify(json.loads(canonical(evidence)))
        if not isinstance(proof,dict) or proof.get('verified') is not True or any(proof.get(k)!=evidence[k] for k in fields):raise AdmissionError('Authenticated credential-health observation required')
        if not isinstance(evidence['evidence_sha256'],str) or not HEX.fullmatch(evidence['evidence_sha256']):raise AdmissionError('Health evidence hash required')
        integer(evidence['auth_event_seq']);integer(evidence['auth_failed_at_ms'])
        observed=integer(evidence['observed_at_ms']);expires=integer(evidence['expires_at_ms'])
        with self.transaction() as db:
            now=self._now(db);challenge=self._credential_challenge(db,pool)
            if any(evidence[k]!=v for k,v in challenge.items()):raise AdmissionError('Credential-health binding changed')
            if not challenge['auth_failed_at_ms']<=observed<=now<expires or expires-observed>300000:raise AdmissionError('Credential-health observation stale or unbounded')
            if self._pool(db,pool)[1]:
                prior=db.execute("SELECT payload FROM audit WHERE event='AUTH_RECOVERED' ORDER BY seq DESC").fetchall()
                expected={'pool':pool,'auth_event_seq':challenge['auth_event_seq'],'evidence_sha256':evidence['evidence_sha256']}
                if not any(json.loads(row[0])==expected for row in prior):raise AdmissionError('Authentication already recovered by different evidence')
                return {'status':'recovered','pool':pool,'auth_event_seq':challenge['auth_event_seq']}
            db.execute('UPDATE pools SET auth_ok=1 WHERE id=?',(pool,))
            self._event(db,now,'AUTH_RECOVERED',None,{'pool':pool,'auth_event_seq':challenge['auth_event_seq'],'evidence_sha256':evidence['evidence_sha256']})
            return {'status':'recovered','pool':pool,'auth_event_seq':challenge['auth_event_seq']}

    def recover_expired(self):
        with self.transaction() as db:return self._expire(db,self._now(db))

    def claim_lineage(self,key,binding,attempt):
        """Fence one logical native ticket across native lease expiry/epochs.

        This is an effect-intent ledger, not native task status. A crash retains
        the intent indefinitely; only its live token or verified reconciliation
        can record a confirmed outcome and allow another bounded native attempt.
        """
        identifier(key)
        if not isinstance(binding,dict) or not isinstance(attempt,dict):raise AdmissionError('Complete lineage binding and attempt required')
        bound=digest({'database_id':self.database_id,'config_sha256':digest(self.config),'binding':binding})
        attempt=canonical(attempt)
        with self.transaction() as db:
            now=self._now(db)
            if self.budget_policy and now>=self.budget_policy.expires_ms:return {'status':'budget_policy_expired'}
            row=db.execute('SELECT binding_sha256,epoch,status FROM lineages WHERE key=?',(key,)).fetchone()
            if row and row[0]!=bound:raise AdmissionError('Lineage source/profile identity changed; trusted reconciliation required')
            if row and row[2]=='held':return {'status':'held','epoch':row[1]}
            epoch=integer(row[1]+1 if row else 1);token=secrets.token_hex(32)
            db.execute('INSERT INTO lineages VALUES (?,?,?,?,?,?,NULL,?) ON CONFLICT(key) DO UPDATE SET epoch=excluded.epoch,token_sha256=excluded.token_sha256,status=excluded.status,attempt=excluded.attempt,outcome=NULL,updated_ms=excluded.updated_ms',
                       (key,bound,epoch,hashlib.sha256(token.encode()).hexdigest(),'held',attempt,now))
            self._event(db,now,'LINEAGE_INTENT',key,{'binding_sha256':bound,'epoch':epoch,'attempt':json.loads(attempt)})
            return {'status':'acquired','epoch':epoch,'token':token,'binding_sha256':bound}

    def release_lineage(self,key,fence,outcome):
        if not isinstance(outcome,dict) or outcome.get('status') not in ('unclaimed','refused-known','submitted'):raise AdmissionError('Confirmed lineage outcome required')
        with self.transaction() as db:
            now=self._now(db)
            row=db.execute('SELECT epoch,token_sha256,status FROM lineages WHERE key=?',(identifier(key),)).fetchone()
            if not row or row[2]!='held' or not isinstance(fence,dict) or row[0]!=fence.get('epoch') or not isinstance(fence.get('token'),str) or not row[1] or not hmac.compare_digest(hashlib.sha256(fence['token'].encode()).hexdigest(),row[1]):raise AdmissionError('Lineage owner fenced')
            db.execute("UPDATE lineages SET status='confirmed',token_sha256=NULL,outcome=?,updated_ms=? WHERE key=?",(canonical(outcome),now,key))
            self._event(db,now,'LINEAGE_CONFIRMED',key,{'epoch':row[0],'outcome':outcome})
            return {'status':'confirmed','epoch':row[0]}

    def reconcile_lineage(self,key,evidence,verify):
        """Operator-owned verifier must authenticate native AND provider outcome."""
        fields={'database_id','lineage_key','binding_sha256','epoch','outcome','evidence_sha256'}
        if not callable(verify) or not isinstance(evidence,dict) or set(evidence)!=fields:raise AdmissionError('Bound lineage reconciliation evidence required')
        evidence=json.loads(canonical(evidence));proof=verify(json.loads(canonical(evidence)))
        if not isinstance(proof,dict) or proof.get('verified') is not True or any(proof.get(k)!=evidence[k] for k in fields):raise AdmissionError('Authenticated lineage observation required')
        if not isinstance(evidence['evidence_sha256'],str) or not HEX.fullmatch(evidence['evidence_sha256']):raise AdmissionError('Lineage evidence hash required')
        outcome=evidence['outcome']
        if not isinstance(outcome,dict) or outcome.get('status') not in ('unclaimed','refused-known','submitted'):raise AdmissionError('Confirmed lineage outcome required')
        with self.transaction() as db:
            now=self._now(db)
            row=db.execute('SELECT binding_sha256,epoch,status FROM lineages WHERE key=?',(identifier(key),)).fetchone()
            if not row or row[2]!='held' or evidence['database_id']!=self.database_id or evidence['lineage_key']!=key or evidence['binding_sha256']!=row[0] or type(evidence['epoch']) is not int or evidence['epoch']!=row[1]:raise AdmissionError('Lineage reconciliation binding mismatch')
            db.execute("UPDATE lineages SET status='confirmed',token_sha256=NULL,outcome=?,updated_ms=? WHERE key=?",(canonical(outcome),now,key))
            self._event(db,now,'LINEAGE_RECONCILED',key,{'evidence_sha256':evidence['evidence_sha256'],'outcome':outcome})
            return {'status':'confirmed','epoch':row[1]}

    def reconcile(self,key,evidence,verify):
        # The verifier is an operator-supplied trusted integration, never loaded
        # from a worker file or replaced by an authenticated:true input field.
        if not callable(verify) or not isinstance(evidence,dict):raise AdmissionError('External usage verifier required')
        evidence=json.loads(canonical(evidence));proof=verify(json.loads(canonical(evidence)))
        expected={'evidence_sha256','reservation_key','database_id','binding_sha256','actual'}
        if set(evidence)!=expected or not isinstance(proof,dict) or proof.get('verified') is not True or any(proof.get(k)!=evidence[k] for k in expected):raise AdmissionError('Usage proof missing, unverified or unbound')
        if not isinstance(evidence['evidence_sha256'],str) or not HEX.fullmatch(evidence['evidence_sha256']):raise AdmissionError('Usage evidence hash required')
        actual=quantities(evidence['actual'])
        with self.transaction() as db:
            now=self._now(db);row=self._row(db,key)
            if evidence['reservation_key']!=key or evidence['database_id']!=self.database_id or evidence['binding_sha256']!=row['binding_sha256']:raise AdmissionError('Usage evidence belongs to another operation')
            if row['status']=='settled':
                if row['charged']!=canonical(actual) or row['evidence_sha256']!=evidence['evidence_sha256']:raise AdmissionError('Conflicting reconciliation')
                return self.public(row)
            if row['status']!='unknown':raise AdmissionError('Only unknown outcomes can be reconciled')
            requested=json.loads(row['requested']);overrun=any(actual[d]>requested[d] for d in DIMENSIONS)
            charged={d:max(actual[d],requested[d]) for d in DIMENSIONS} if overrun else actual
            status='quarantined' if overrun else 'settled'
            db.execute('UPDATE reservations SET status=?,charged=?,settled_ms=?,evidence_sha256=? WHERE key=?',(status,canonical(charged),now,evidence['evidence_sha256'],key))
            if overrun:db.execute('UPDATE pools SET quarantined=1 WHERE id=?',(row['pool'],))
            self._event(db,now,'RECONCILED',key,{'actual':actual,'evidence_sha256':evidence['evidence_sha256']});return self.public(self._row(db,key))

    def snapshot(self):
        with self.transaction() as db:
            return self._snapshot(db,self._now(db))

    def inspect(self):
        """Coherent readiness read; no reservation, audit, clock or expiry writes."""
        with self.transaction(read_only=True) as db:
            now=integer(self.clock());last=int(db.execute("SELECT value FROM meta WHERE key='last_ms'").fetchone()[0])
            if now<last:raise AdmissionError('Clock moved backwards; reconcile trusted clock before admission')
            return self._snapshot(db,now)

    def _snapshot(self,db,now):
        reservations={key:self.public(self._row(db,key)) for (key,) in db.execute('SELECT key FROM reservations').fetchall()}
        pools={pool:{**self._usage(db,pool,now),'retry_at_ms':state[0],'auth_ok':bool(state[1]),'quarantined':bool(state[2])} for pool in self.config['pools'] for state in [self._pool(db,pool)]}
        lineages={row[0]:{'binding_sha256':row[1],'epoch':row[2],'status':row[3],'attempt':json.loads(row[4]),'outcome':json.loads(row[5]) if row[5] else None} for row in db.execute('SELECT key,binding_sha256,epoch,status,attempt,outcome FROM lineages')}
        result={'database_id':self.database_id,'config_sha256':digest(self.config),'pools':pools,'global':self._usage(db,None,now),'reservations':reservations,'lineages':lineages}
        if self.budget_policy:result.update(budget_policy={**self.budget_policy.identity,'expires_at_ms':self.budget_policy.expires_ms,'expired':now>=self.budget_policy.expires_ms},effective_ceilings=self.budget_policy.ceilings)
        return result

    def verify_audit(self):
        with self.transaction() as db:
            prior=None
            for index,row in enumerate(db.execute('SELECT seq,at_ms,event,reservation_key,payload,prior_hash,hash FROM audit ORDER BY seq'),1):
                seq,now,event,key,payload,previous,actual=row
                record={'seq':seq,'at_ms':now,'event':event,'reservation_key':key,'payload':json.loads(payload),'prior_hash':previous}
                if seq!=index or previous!=prior or digest(record)!=actual:return False
                prior=actual
            return True


def add_policy_args(parser):
    for name in ('budget-profile','budget-profile-sha','budget-policy-sha'):parser.add_argument('--'+name)
    parser.add_argument('--budget-epoch',type=int)

def policy_args(args):
    values={'profile':args.budget_profile,'profileSha':args.budget_profile_sha,'epoch':args.budget_epoch,'policySha':args.budget_policy_sha}
    return values if any(v is not None for v in values.values()) else None

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['initialize','reserve','claim_dispatch','heartbeat','settle','mark_unknown','cancel','refuse','auth_expired','credential_challenge','recover_expired','claim_lineage','release_lineage','snapshot','inspect','verify_audit']);parser.add_argument('--database',required=True);parser.add_argument('--config',required=True);parser.add_argument('--database-id');add_policy_args(parser);args=parser.parse_args()
    with open(args.config,'rb') as config_file:config_raw=config_file.read(65537)
    if len(config_raw)>65536:raise AdmissionError('Bounded broker configuration required')
    config=json.loads(config_raw);raw=sys.stdin.buffer.read(65537)
    if len(raw)>65536:raise AdmissionError('Bounded JSON input required')
    params=json.loads(raw) if raw.strip() else {}
    if not isinstance(params,dict):raise AdmissionError('JSON object input required')
    if args.command=='initialize':
        if params or args.database_id or policy_args(args):raise AdmissionError('Initialize does not accept operation parameters')
        return {'database_id':initialize(args.database,config)}
    broker=Broker(args.database,config,args.database_id,budget_policy=policy_args(args))
    return getattr(broker,args.command)(**params)

if __name__=='__main__':
    try:print(json.dumps({'ok':True,'result':main()},separators=(',',':')))
    except (ValueError,OSError,sqlite3.Error,TypeError) as error:
        print(json.dumps({'ok':False,'error':type(error).__name__,'message':str(error)[:500]},separators=(',',':')));raise SystemExit(1)
