"""Durable dispatch evidence shared by fixed media workers; contains no content or keys."""
import json
import os
from pathlib import Path
import time
from uuid import uuid4


def journal(job, call=None, response=None):
    path = Path(job.get('usagePath') or Path(job['output']) / 'model-usage.json')
    try:
        calls = json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError):
        calls = []
    if call is None:
        call = {'id': str(uuid4()), 'attempted': True, 'at': int(time.time() * 1000),
                'model': job['endpoint']['model']}
        calls.append(call)
    elif isinstance(response, dict):
        call = {**call}
        if isinstance(response.get('model'), str):
            call['model'] = response['model']
        if isinstance(response.get('usage'), dict):
            usage = response['usage']
            allowed = ('prompt_tokens', 'input_tokens', 'completion_tokens', 'output_tokens', 'total_tokens',
                       'prompt_cache_hit_tokens', 'cache_creation_input_tokens')
            call['usage'] = {key: usage[key] for key in allowed if type(usage.get(key)) is int}
            for key in ('prompt_tokens_details', 'input_tokens_details', 'completion_tokens_details', 'output_tokens_details'):
                if isinstance(usage.get(key), dict):
                    call['usage'][key] = {k: v for k, v in usage[key].items()
                                          if k in ('cached_tokens', 'cache_write_tokens', 'reasoning_tokens') and type(v) is int}
        calls = [call if row['id'] == call['id'] else row for row in calls]
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(calls), encoding='utf-8')
    os.replace(temporary, path)
    return call
