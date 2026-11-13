import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('research_gate', Path(__file__).with_name('gate_ticket.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class ResearchGateTests(unittest.TestCase):
    def fixture(self):
        return json.loads(Path(__file__).with_name('findings').joinpath('01_referee_loops.json').read_text())

    def test_reports_conform_but_starters_cannot_complete_tickets(self):
        for file in Path(__file__).with_name('findings').glob('*.json'):
            gate.validate_report(json.loads(file.read_text()))
        with self.assertRaisesRegex(ValueError, 'Starter findings'):
            gate.main('T-104')

    def test_unimplemented_semantic_gate_cannot_return_success(self):
        for ticket in ['T-101','T-201','T-202','T-301','unknown']:
            with self.assertRaisesRegex(ValueError, 'GATE_NOT_IMPLEMENTED'):
                gate.main(ticket)

    def test_missing_evidence_and_extra_state_are_refused(self):
        invalid = self.fixture(); invalid['claims'][0]['source_ids']=['R1-S999']
        with self.assertRaisesRegex(ValueError, 'Unknown source'):
            gate.validate_report(invalid)
        invalid = self.fixture(); invalid['world_state']={}
        with self.assertRaisesRegex(ValueError, 'unknown field'):
            gate.validate_report(invalid)

    def test_new_schema_keywords_do_not_silently_bypass_validation(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported schema'):
            gate.check('anything', {'oneOf':[{'const':'expected'}]})

    def test_retrieval_dates_allow_later_research_but_reject_invalid_dates(self):
        later = self.fixture(); later['sources'][0]['accessed_on'] = '2026-11-14'
        gate.validate_report(later)
        later['sources'][0]['accessed_on'] = '2026-02-30'
        with self.assertRaises(ValueError):
            gate.validate_report(later)

if __name__ == '__main__':
    unittest.main()
