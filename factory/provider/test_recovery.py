import unittest
import test_broker as fixtures


class CredentialRecoveryTests(unittest.TestCase):
    setUp=fixtures.BrokerTests.setUp
    reserve=fixtures.BrokerTests.reserve
    claim=fixtures.BrokerTests.claim
    def test_recovery_is_bound_to_current_auth_event_and_preserves_liabilities(self):
        self.reserve(); fence=self.claim(); self.b.mark_unknown('r',fence)
        self.b.refuse('a',retry_at_ms=1000);self.b.auth_expired('a')
        challenge=self.b.credential_challenge('a')
        self.time=10
        evidence={**challenge,'observed_at_ms':10,'expires_at_ms':100,'evidence_sha256':'e'*64}
        self.assertEqual(self.b.recover_credential('a',evidence,lambda e:{'verified':True,**e})['status'],'recovered')
        state=self.b.snapshot()
        self.assertTrue(state['pools']['a']['auth_ok'])
        self.assertEqual(state['pools']['a']['retry_at_ms'],1000)
        self.assertEqual(state['reservations']['r']['status'],'unknown')
        self.assertEqual(state['global']['held']['spend_microusd'],70)
        self.b.auth_expired('a')
        with self.assertRaises(ValueError):self.b.recover_credential('a',evidence,lambda e:{'verified':True,**e})

    def test_recovery_refuses_unverified_stale_cross_pool_or_changed_config(self):
        self.b.auth_expired('a');challenge=self.b.credential_challenge('a');self.time=10
        evidence={**challenge,'observed_at_ms':10,'expires_at_ms':100,'evidence_sha256':'e'*64}
        with self.assertRaises(ValueError):self.b.recover_credential('a',evidence,lambda e:e)
        for key,value in [('pool','b'),('database_id','f'*32),('config_sha256','f'*64),('credential_ref','b-credential'),('observed_at_ms',11),('expires_at_ms',10)]:
            wrong={**evidence,key:value}
            with self.subTest(key=key),self.assertRaises(ValueError):self.b.recover_credential('a',wrong,lambda e:{'verified':True,**e})
        self.assertFalse(self.b.snapshot()['pools']['a']['auth_ok'])


if __name__=='__main__':unittest.main()
