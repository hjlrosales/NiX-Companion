import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('voice cloning commands escape Windows paths for Coqui TTS', () => {
  const projectRoot = resolve(__dirname, '..');
  const python = resolve(projectRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const scriptPath = resolve(projectRoot, 'scripts', 'voice.py');
  const values = [
    'C:\\Program Files\\NiX Companion\\resources\\app\\.venv\\Lib\\site-packages',
    'C:\\Users\\Test\\voice\\text.txt',
    'C:\\Users\\Test\\voice\\ref.wav',
    'C:\\Users\\Test\\voice\\output.wav',
  ];
  const code = `
import json, runpy, pathlib
path = pathlib.Path(${JSON.stringify(scriptPath)})
ns = runpy.run_path(str(path))
values = json.loads(${JSON.stringify(JSON.stringify(values))})
for value in values:
    literal = ns['_python_literal'](value)
    assert literal == repr(value), (value, literal)
command = ns['_coqui_tts_command'](values[1], values[2], values[3])
assert 'site-packages' in command, command
assert 'text=_text' in command or 'text_file=' in command, command
assert 'speaker_wav=' in command, command
assert 'file_path=' in command, command
compile(command, '<string>', 'exec')
print('OK')
`;
  const result = spawnSync(python, ['-c', code], { cwd: projectRoot, encoding: 'utf-8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'python exited with a non-zero status');
});
