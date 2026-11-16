import hashlib
from contextlib import closing
import json
import multiprocessing as mp
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

from broker import Broker, initialize, AdmissionError, DIMENSIONS


def q(spend=100, requests=100, input_tokens=1000, output_tokens=1000):
    return dict(requests=requests,input_tokens=input_tokens,output_tokens=output_tokens,spend_microusd=spend)


def config():
    return {'schema_version':1,'global':{'lifetime':q(150),'windows':[]},'pools':{
        p:{'credential_ref':p+'-credential','models':['model-a'],'lifetime':q(100),'windows':[{'milliseconds':100,'limits':q(100,5)}]} for p in ('a','b')}}


def binding(pool='a', request='x'):
    return {'task_sha256':'1'*64,'request_sha256':hashlib.sha256(request.encode()).hexdigest(),
            'source_sha256':'2'*64,'model':'model-a','credential_ref':pool+'-credential'}


def contender(db, identity, barrier, results, key, pool):
    broker=Broker(db,config(),identity,clock=lambda:0)
    barrier.wait(10)
    results.put(broker.reserve(pool,key,q(80,1,1,1),binding(pool))['status'])


def crash_before_commit(db, identity):
    broker=Broker(db,config(),identity,clock=lambda:0)
    # Crash after the reservation INSERT but before its event and COMMIT.
    broker._event=lambda *args:os._exit(73)
    broker.reserve('a','crashed',q(80,1,1,1),binding())


class BrokerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'broker.sqlite';self.conf=config();self.time=0
        self.identity=initialize(self.path,self.conf)
        self.b=Broker(self.path,self.conf,self.identity,clock=lambda:self.time)

    def reserve(self,key='r', amount=70,pool='a'):
        return self.b.reserve(pool,key,q(amount,1,2,3),binding(pool))

    def claim(self,key='r',ttl=50):return self.b.claim_dispatch(key,'worker',lease_ms=ttl)

    def test_read_only_inspection_does_not_advance_clock_or_write_ledger(self):
        self.reserve();fence=self.claim();self.b.mark_unknown('r',fence)
        before=self.path.read_bytes();self.time=1000
        inspected=self.b.inspect()
        self.assertEqual(inspected['reservations']['r']['status'],'unknown')
        self.assertEqual(inspected['global']['held']['spend_microusd'],70)
        self.assertEqual(self.path.read_bytes(),before)
        with sqlite3.connect(self.path) as db:self.assertEqual(db.execute("SELECT value FROM meta WHERE key='last_ms'").fetchone()[0],'0')

    def test_global_multi_process_budget_atomic_across_pools(self):
        ctx=mp.get_context('spawn');barrier=ctx.Barrier(6);results=ctx.Queue()
        children=[ctx.Process(target=contender,args=(str(self.path),self.identity,barrier,results,str(i),'ab'[i%2])) for i in range(6)]
        for p in children:p.start()
        try:
            status=[results.get(timeout=15) for _ in children]
            self.assertEqual(status.count('reserved'),1);self.assertEqual(status.count('budget_refused'),5)
        finally:
            for p in children:
                p.join(5)
                if p.is_alive():p.kill();p.join()
            results.close()
        self.assertTrue(all(p.exitcode==0 for p in children))

    def test_each_dimension_and_overflow_are_admission_limits(self):
        for dimension in DIMENSIONS:
            with self.subTest(dimension=dimension):
                value=q(1,1,1,1);value[dimension]=self.conf['pools']['a']['lifetime'][dimension]+1
                self.assertEqual(self.b.reserve('a',dimension,value,binding())['status'],'budget_refused')
        with self.assertRaises(ValueError):self.b.reserve('a','unsafe',q(2**53),binding())
        with self.assertRaises(ValueError):self.b.reserve('a','bool',q(True),binding())

    def test_binding_changes_and_config_changes_refuse(self):
        self.reserve();self.assertEqual(self.reserve()['status'],'reserved')
        for field,value in [('model','model-b'),('source_sha256','3'*64),('task_sha256','3'*64),('request_sha256','3'*64)]:
            changed=binding();changed[field]=value
            with self.assertRaises(ValueError):self.b.reserve('a','r',q(70,1,2,3),changed)
        changed=json.loads(json.dumps(self.conf));changed['global']['lifetime']['requests']+=1
        with self.assertRaises(ValueError):Broker(self.path,changed,self.identity)

    def test_dispatch_once_and_expired_worker_fenced_after_restart(self):
        self.reserve();f=self.claim();self.assertEqual(f['status'],'dispatched')
        self.assertEqual(self.claim()['status'],'dispatch_refused')
        self.time=51;reopened=Broker(self.path,self.conf,self.identity,clock=lambda:self.time)
        self.assertEqual(reopened.recover_expired()['recovered'],['r'])
        with self.assertRaises(ValueError):reopened.settle('r',f,q(40,1,2,3))
        self.assertEqual(reopened.snapshot()['reservations']['r']['status'],'unknown')
        self.assertEqual(reopened.claim_dispatch('r','replacement')['status'],'dispatch_refused')

    def test_unknown_outcome_survives_window_reset_and_expiry(self):
        self.reserve();f=self.claim();self.b.mark_unknown('r',f);self.time=10000
        self.b.recover_expired()
        self.assertEqual(self.b.reserve('a','extra',q(40,1,1,1),binding())['status'],'budget_refused')
        state=self.b.snapshot();self.assertEqual(state['pools']['a']['held']['spend_microusd'],70)

    def test_window_releases_only_settled_usage_and_global_lifetime_stays(self):
        for i in range(5):
            key=str(i);self.reserve(key,1);f=self.claim(key);self.b.settle(key,f,q(1,1,2,3))
        self.assertEqual(self.reserve('six',1)['status'],'budget_refused')
        self.time=101;self.assertEqual(self.reserve('six',1)['status'],'reserved')
        self.assertEqual(self.b.snapshot()['global']['spent']['requests'],5)

    def test_global_rolling_window_limits_every_dimension_across_pools(self):
        conf=config();conf['global']['windows']=[{'milliseconds':100,'limits':q(100,2,10,10)}]
        path=Path(self.tmp.name)/'window.sqlite';identity=initialize(path,conf)
        b=Broker(path,conf,identity,clock=lambda:self.time)
        b.reserve('a','first',q(45,1,1,1),binding());f=b.claim_dispatch('first','worker')
        b.settle('first',f,q(45,1,1,1))
        for dimension in DIMENSIONS:
            requested=q(1,1,1,1)
            requested[dimension]=conf['global']['windows'][0]['limits'][dimension]-q(45,1,1,1)[dimension]+1
            self.assertEqual(b.reserve('b',dimension,requested,binding('b'))['status'],'budget_refused')
        self.time=101
        self.assertEqual(b.reserve('b','after-window',q(56,1,1,1),binding('b'))['status'],'reserved')
        self.assertEqual(b.snapshot()['global']['spent']['spend_microusd'],45)

    def test_clock_rollback_auth_and_cooldown_fail_closed(self):
        self.reserve();self.b.refuse('a',retry_at_ms=120)
        self.time=119;self.assertEqual(self.claim()['status'],'cooldown')
        self.time=120;self.assertEqual(self.claim()['status'],'dispatched')
        self.b.auth_expired('a');self.assertEqual(self.reserve('new',1)['status'],'auth_required')
        self.time=0
        with self.assertRaises(ValueError):self.reserve('rollback',1)

    def test_cancellation_before_and_after_dispatch_accounting(self):
        self.reserve();self.assertEqual(self.b.cancel('r')['status'],'cancelled')
        self.reserve('after');f=self.claim('after');self.assertEqual(self.b.cancel('after',f)['status'],'unknown')
        self.assertEqual(self.b.snapshot()['global']['held']['spend_microusd'],70)

    def test_reconciliation_requires_external_verification_and_exact_binding(self):
        self.reserve();f=self.claim();self.b.mark_unknown('r',f)
        with self.assertRaises(ValueError):self.b.reconcile('r',{'actual':q(30)},lambda e:True)
        evidence={'evidence_sha256':'4'*64,'reservation_key':'r','database_id':self.identity,'binding_sha256':self.b.snapshot()['reservations']['r']['binding_sha256'],'actual':q(30,1,2,3)}
        with self.assertRaises(ValueError):self.b.reconcile('r',evidence,lambda e:{'verified':False})
        result=self.b.reconcile('r',evidence,lambda e:{'verified':True,'evidence_sha256':e['evidence_sha256'],'reservation_key':e['reservation_key'],'database_id':e['database_id'],'binding_sha256':e['binding_sha256'],'actual':e['actual']})
        self.assertEqual(result['status'],'settled');self.assertEqual(self.b.snapshot()['global']['held']['spend_microusd'],0)
        self.assertEqual(self.b.snapshot()['global']['spent']['spend_microusd'],30)

    def test_overrun_records_debt_and_quarantines_pool(self):
        self.reserve();f=self.claim();result=self.b.settle('r',f,q(90,1,2,3))
        self.assertEqual(result['status'],'quarantined')
        self.assertEqual(self.b.snapshot()['global']['held']['spend_microusd'],90)
        self.assertEqual(self.reserve('later',1)['status'],'quarantined')

    def test_missing_corrupt_or_replaced_database_never_reinitializes(self):
        with self.assertRaises(ValueError):Broker(self.path,self.conf,'0'*32)
        self.path.unlink()
        with self.assertRaises((OSError,ValueError)):Broker(self.path,self.conf,self.identity)
        self.assertFalse(self.path.exists())
        self.path.write_bytes(b'not sqlite')
        with self.assertRaises((sqlite3.DatabaseError,ValueError)):Broker(self.path,self.conf,self.identity)

    def test_expired_undispatched_reservation_cancels_without_reusing_key(self):
        self.b.reserve('a','r',q(70,1,2,3),binding(),ttl_ms=10)
        self.time=10;self.assertEqual(self.b.recover_expired()['cancelled'],['r'])
        self.assertEqual(self.claim()['status'],'dispatch_refused')
        self.assertEqual(self.reserve('replacement',90)['status'],'reserved')

    def test_process_crash_before_commit_cannot_leave_half_a_reservation(self):
        worker=mp.get_context('spawn').Process(target=crash_before_commit,args=(str(self.path),self.identity))
        worker.start();worker.join(10)
        if worker.is_alive():worker.kill();worker.join();self.fail('crash worker timed out')
        self.assertEqual(worker.exitcode,73)
        reopened=Broker(self.path,self.conf,self.identity,clock=lambda:0)
        self.assertEqual(reopened.snapshot()['reservations'],{})
        self.assertEqual(self.reserve('replacement',90)['status'],'reserved')

    def test_schema_corruption_and_invalid_semantic_state_fail_closed(self):
        with closing(sqlite3.connect(self.path)) as db, db:db.execute('CREATE TABLE unexpected (value TEXT)')
        with self.assertRaises(ValueError):self.reserve()
        with closing(sqlite3.connect(self.path)) as db, db:db.execute('DROP TABLE unexpected');db.execute('UPDATE pools SET auth_ok=2')
        with self.assertRaises(ValueError):self.reserve()

    def test_recovery_never_takes_a_live_lease_and_forged_fences_fail(self):
        self.reserve();f=self.claim();self.time=20
        reopened=Broker(self.path,self.conf,self.identity,clock=lambda:self.time)
        self.assertEqual(reopened.recover_expired()['recovered'],[])
        for field,value in [('owner','other'),('epoch',999),('token','forged')]:
            with self.assertRaises(ValueError):reopened.settle('r',{**f,field:value},q(40,1,2,3))
        reopened.heartbeat('r',f,lease_ms=50);self.time=51
        self.assertEqual(reopened.recover_expired()['recovered'],[])
        self.time=71;self.assertEqual(reopened.recover_expired()['recovered'],['r'])
        with self.assertRaises(ValueError):reopened.heartbeat('r',f)

    def test_snapshot_omits_dispatch_secret_and_audit_is_bound(self):
        self.reserve();f=self.claim();self.b.settle('r',f,q(30,1,2,3))
        self.assertNotIn(f['token'],json.dumps(self.b.snapshot()))
        self.assertTrue(self.b.verify_audit())
        with closing(sqlite3.connect(self.path)) as db, db:db.execute("UPDATE audit SET event='ALTERED' WHERE seq=1")
        self.assertFalse(self.b.verify_audit())

    def test_reconciliation_cannot_release_another_operation(self):
        self.reserve();f=self.claim();self.b.mark_unknown('r',f)
        base={'evidence_sha256':'4'*64,'reservation_key':'r','database_id':self.identity,'binding_sha256':self.b.snapshot()['reservations']['r']['binding_sha256'],'actual':q(0,0,0,0)}
        for field,value in [('database_id','0'*32),('binding_sha256','0'*64),('reservation_key','another')]:
            evidence={**base,field:value}
            with self.assertRaises(ValueError):self.b.reconcile('r',evidence,lambda e:{'verified':True,**e})
        self.assertEqual(self.b.snapshot()['global']['held']['spend_microusd'],70)

    def test_native_lineage_survives_time_epoch_worker_and_source_changes(self):
        binding={'repo':'repo','ticket':'A','source':'1'*64}
        claim=self.b.claim_lineage('native-A',binding,{'epoch':1})
        self.time=100000
        reopened=Broker(self.path,self.conf,self.identity,clock=lambda:self.time)
        self.assertEqual(reopened.claim_lineage('native-A',binding,{'epoch':99})['status'],'held')
        with self.assertRaises(ValueError):reopened.claim_lineage('native-A',{**binding,'source':'2'*64},{'epoch':99})
        self.assertNotIn(claim['token'],json.dumps(reopened.snapshot()))
        with self.assertRaises(ValueError):reopened.release_lineage('native-A',{'epoch':1,'token':'forged'},{'status':'submitted'})
        reopened.release_lineage('native-A',claim,{'status':'submitted','candidate':'3'*40})
        self.assertEqual(reopened.claim_lineage('native-A',binding,{'epoch':2})['status'],'acquired')

    def test_lost_lineage_requires_bound_external_reconciliation(self):
        claim=self.b.claim_lineage('native-A',{'ticket':'A'},{'epoch':1})
        evidence={'database_id':self.identity,'lineage_key':'native-A','binding_sha256':claim['binding_sha256'],'epoch':1,
                  'outcome':{'status':'refused-known'},'evidence_sha256':'4'*64}
        with self.assertRaises(ValueError):self.b.reconcile_lineage('native-A',evidence,lambda e:True)
        changed={**evidence,'epoch':2}
        with self.assertRaises(ValueError):self.b.reconcile_lineage('native-A',changed,lambda e:{'verified':True,**e})
        self.assertEqual(self.b.reconcile_lineage('native-A',evidence,lambda e:{'verified':True,**e})['status'],'confirmed')


if __name__=='__main__':unittest.main(verbosity=2)
