#!/usr/bin/env python3
"""Offline report-format gate. Unknown/future semantic gates refuse explicitly.

This intentionally supports only the JSON Schema keywords used by report.schema.json;
new keywords refuse rather than silently bypass validation. It proves format and pinned
boundaries, not source truth, licensing clearance, or implemented game mechanics.
"""
import hashlib
from datetime import date
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]

def check(value, schema, path='$'):
    known = {'$schema', '$id', 'type', 'additionalProperties', 'properties', 'required', 'enum', 'const', 'minLength', 'pattern', 'items', 'minItems', 'uniqueItems'}
    if set(schema) - known:
        raise ValueError('Unsupported schema keywords: ' + str(set(schema) - known))
    if 'const' in schema and value != schema['const']:
        raise ValueError(path + ': wrong constant')
    if 'enum' in schema and value not in schema['enum']:
        raise ValueError(path + ': invalid enum')
    types = schema.get('type', [])
    types = [types] if isinstance(types, str) else types
    actual = 'null' if value is None else 'boolean' if type(value) is bool else 'string' if type(value) is str else 'object' if type(value) is dict else 'array' if type(value) is list else 'integer' if type(value) is int else 'number'
    if types and actual not in types:
        raise ValueError(path + ': wrong type')
    if actual == 'object':
        fields = schema.get('properties', {})
        if set(schema.get('required', [])) - set(value):
            raise ValueError(path + ': missing field')
        if schema.get('additionalProperties') is False and set(value) - set(fields):
            raise ValueError(path + ': unknown field')
        for key, child in value.items():
            if key in fields:
                check(child, fields[key], path + '.' + key)
    if actual == 'array':
        if len(value) < schema.get('minItems', 0):
            raise ValueError(path + ': too few items')
        if schema.get('uniqueItems') and len({json.dumps(x, sort_keys=True) for x in value}) != len(value):
            raise ValueError(path + ': duplicate item')
        for index, child in enumerate(value):
            check(child, schema.get('items', {}), f'{path}[{index}]')
    if actual == 'string':
        if len(value) < schema.get('minLength', 0) or ('pattern' in schema and not re.search(schema['pattern'], value)):
            raise ValueError(path + ': invalid string')

def validate_report(report):
    check(report, json.loads((ROOT / 'RESEARCH/schemas/report.schema.json').read_text()))
    for source in report['sources']:
        date.fromisoformat(source['accessed_on'])
    sources = {s['id']: s for s in report['sources']}
    ids = set()
    for group, prefix in [('sources', 'S'), ('claims', 'C'), ('proposals', 'P'), ('benchmarks', 'B')]:
        for item in report[group]:
            if not re.fullmatch(report['lane'] + '-' + prefix + r'[1-9][0-9]*', item['id']) or item['id'] in ids:
                raise ValueError('Invalid or duplicate ID')
            ids.add(item['id'])
    for item in report['claims'] + report['proposals']:
        if set(item['source_ids']) - set(sources):
            raise ValueError('Unknown source')
    for claim in report['claims']:
        if claim['basis'] == 'documented' and (not claim['source_ids'] or all(sources[s]['retrieval'] == 'unavailable' for s in claim['source_ids'])):
            raise ValueError('Documented claim lacks retrieved evidence')
    if report['producer']['kind'] == 'codex_starter' and (report['status'] != 'starter' or report['producer']['paid_run'] or report['producer']['executed_model'] is not None):
        raise ValueError('Invalid starter provenance')
    if report['producer']['kind'] == 'vendor_run' and not report['producer']['executed_model']:
        raise ValueError('Missing actual model provenance')
    if report['requested_model'] != ('grok-4.7' if report['lane'] == 'R5' else 'grok-4.3'):
        raise ValueError('Wrong lane routing')
    for benchmark in report['benchmarks']:
        path = benchmark['coverage_path']
        if benchmark['status'] == 'proposed' and path is not None:
            raise ValueError('Future benchmark cannot claim existing coverage')
        if benchmark['status'] == 'existing_source_assertion':
            if not path or path.startswith('/') or any(p in ('', '.', '..') for p in path.split('/')) or not (ROOT / path).is_file():
                raise ValueError('Missing or unsafe coverage path')
    return report

def main(ticket):
    manifest = json.loads((ROOT / 'RESEARCH/manifest.json').read_text())
    lanes = {f'T-{104+i}': row for i, row in enumerate(manifest['reports'])}
    if ticket not in lanes:
        raise ValueError('GATE_NOT_IMPLEMENTED: ' + ticket + ' requires a separately reviewed source/graph/synthesis oracle; no heading-only success is allowed')
    row = lanes[ticket]
    report = validate_report(json.loads((ROOT / 'RESEARCH' / row['json']).read_text()))
    if report['lane'] != row['lane'] or report['base_commit'] != manifest['baseline_commit']:
        raise ValueError('Mismatched baseline/lane')
    if report['status'] != 'complete':
        raise ValueError('Starter findings are not a completed vendor ticket')
    freeze = json.loads((ROOT / 'SYSTEMS/CONTRACT_FREEZE.json').read_text())
    for path, expected in freeze['files'].items():
        if hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != expected:
            raise ValueError('Frozen contract changed: ' + path)
    print('PASS report format and frozen boundaries; source review remains separate')

if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Usage: python3 RESEARCH/gate_ticket.py T-104')
        main(sys.argv[1])
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
