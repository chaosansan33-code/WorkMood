import copy
import io
import json
import os
import unittest
from unittest.mock import patch
from backend.app import ApiError, RequestBudget, app, respond, settings, validate_output, validate_request


def reflection():
    return dict(event_summary='報告期限提前，與兩項急件衝突。', emotion='焦慮', need='確認優先順序', problem_type='B', next_action='列出三項任務與期限，再確認順序。', communication_script='能否協助確認三項工作的優先順序？', uncertainty='依目前描述暫分 B 類，請確認。')


def payload():
    return dict(messages=[{'role': 'user', 'content': '主管提前了報告期限，我很焦慮。'}], mood='焦慮', intent='chat', consent=True)


def invoke(path='/api/config', method='GET', data=None, origin='http://127.0.0.1:8780', code='', host='127.0.0.1:8780'):
    raw = json.dumps(data, ensure_ascii=False).encode() if data is not None else b''
    env = {'REQUEST_METHOD': method, 'PATH_INFO': path, 'HTTP_HOST': host, 'HTTP_ORIGIN': origin, 'HTTP_X_WORKMOOD_CODE': code, 'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(raw)), 'wsgi.input': io.BytesIO(raw)}
    result = {}
    def start(status, headers):
        result['status'], result['headers'] = int(status.split()[0]), dict(headers)
    result['body'] = b''.join(app(env, start))
    return result


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'PORT': '8780', 'OPENAI_API_KEY': 'fake-test-key', 'OPENAI_MODEL': 'test-model'}, clear=True)
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_config_does_not_leak_key(self):
        result = invoke()
        self.assertEqual(result['status'], 200)
        self.assertNotIn(b'fake-test-key', result['body'])

    def test_public_requires_private_code(self):
        with patch.dict(os.environ, {'WORKMOOD_PUBLIC': '1'}):
            self.assertFalse(settings()['enabled'])
        with patch.dict(os.environ, {'WORKMOOD_PUBLIC': '1', 'DEMO_ACCESS_CODE': 'long-enough-test-code'}):
            self.assertTrue(settings()['enabled'])

    def test_role_injection_rejected(self):
        data = payload(); data['messages'][0]['role'] = 'system'
        with self.assertRaises(ApiError): validate_request(data)

    def test_consent_and_size_required(self):
        data = payload(); data['consent'] = False
        with self.assertRaises(ApiError): validate_request(data)
        data = payload(); data['messages'][0]['content'] = '字' * 2001
        with self.assertRaises(ApiError): validate_request(data)

    def test_multi_turn_preserved(self):
        data = payload()
        data['messages'] += [{'role': 'assistant', 'content': '最希望確認什麼？'}, {'role': 'user', 'content': '希望先確認優先順序。'}]
        output = {'reply': '整理好了，請確認。', 'phase': 'ready', 'reflection': reflection()}
        provider = {'status': 'completed', 'output': [{'content': [{'type': 'output_text', 'text': json.dumps(output)}]}]}
        with patch('backend.app.urlopen', return_value=io.BytesIO(json.dumps(provider).encode())) as call:
            result = respond(data, settings())
            sent = json.loads(call.call_args.args[0].data)
            self.assertEqual(sent['input'], data['messages'])
            self.assertFalse(sent['store'])
            self.assertTrue(sent['text']['format']['strict'])
            self.assertEqual(result['source'], 'AI · test-model')

    def test_refusal_and_incomplete_fail_closed(self):
        for provider in [{'status': 'incomplete'}, {'status': 'completed', 'output': [{'content': [{'type': 'refusal'}]}]}]:
            with patch('backend.app.urlopen', return_value=io.BytesIO(json.dumps(provider).encode())):
                with self.assertRaises(ApiError): respond(payload(), settings())

    def test_schema_and_phase_constraints(self):
        valid = {'reply': '想先釐清什麼？', 'phase': 'clarify', 'reflection': None}
        self.assertEqual(validate_output(valid), valid)
        bad_values = [dict(valid, reflection=reflection()), dict(valid, phase='unknown'), dict(valid, reply=''), {'reply': 'a'}, dict(valid, phase='ready')]
        for value in bad_values:
            with self.assertRaises(ApiError): validate_output(value)

    def test_non_b_removes_communication(self):
        card = reflection(); card['problem_type'] = 'C'
        out = validate_output({'reply': '一起找支持。', 'phase': 'ready', 'reflection': card})
        self.assertEqual(out['reflection']['communication_script'], '')

    def test_support_never_calls_model(self):
        data = payload(); data['messages'][0]['content'] = '虛構測試：我不想活了'
        with patch('backend.app.urlopen') as call:
            result = respond(data, settings()); call.assert_not_called()
        self.assertEqual(result['phase'], 'support')
        self.assertEqual(result['reflection']['problem_type'], 'C')

    def test_model_support_is_sanitized(self):
        result = validate_output({'reply': '普通建議', 'phase': 'support', 'reflection': reflection()})
        self.assertEqual(result['reflection']['problem_type'], 'C')
        self.assertEqual(result['reflection']['communication_script'], '')

    def test_origins_and_code(self):
        self.assertEqual(invoke('/api/chat', 'POST', payload(), origin='https://untrusted.example')['status'], 403)
        self.assertEqual(invoke('/api/chat', 'POST', payload(), origin='')['status'], 403)
        with patch.dict(os.environ, {'DEMO_ACCESS_CODE': 'private-trial-code'}):
            self.assertEqual(invoke('/api/chat', 'POST', payload(), code='wrong')['status'], 401)
        with patch.dict(os.environ, {'ALLOWED_ORIGINS': 'https://team.github.io'}):
            result = invoke('/api/chat', 'OPTIONS', origin='https://team.github.io')
            self.assertEqual(result['status'], 204)
            self.assertEqual(result['headers']['Access-Control-Allow-Origin'], 'https://team.github.io')

    def test_no_directory_or_secret_files(self):
        for path in ['/backend/prompt.txt', '/.env', '/../server.py']:
            self.assertEqual(invoke(path)['status'], 404)
        self.assertEqual(invoke(host='attacker.example')['status'], 403)
        self.assertEqual(invoke('/')['status'], 200)

    def test_budget(self):
        budget = RequestBudget()
        for i in range(20): self.assertTrue(budget.allow(1))
        self.assertFalse(budget.allow(2))
        self.assertTrue(budget.allow(62))


if __name__ == '__main__':
    unittest.main()
