import json,sys,os,urllib.request,asyncio,subprocess
from pathlib import Path
os.environ['ONNX_PROVIDER']='CPUExecutionProvider'

# ── Auto-install dependencies on first run ──────────────────────────────
def _ensure_package(pkg_name, import_name=None):
    """Try importing a package; if missing, pip install it."""
    imp = import_name or pkg_name
    try:
        __import__(imp)
    except ImportError:
        subprocess.run(
            [sys.executable, '-m', 'pip', 'install', pkg_name, '--quiet', '--disable-pip-version-check'],
            capture_output=True, timeout=120
        )
        # Verify install succeeded
        try:
            __import__(imp)
        except ImportError:
            raise ImportError(
                f"Failed to install {pkg_name}. Install manually: {sys.executable} -m pip install {pkg_name}"
            )

_ensure_package('edge-tts', 'edge_tts')

# Edge-TTS voice presets (high quality neural voices)
VOICE_PRESETS={
    'default':'en-US-GuyNeural',
    'guy':'en-US-GuyNeural',
    'aria':'en-US-AriaNeural',
    'jenny':'en-US-JennyNeural',
    'davis':'en-US-DavisNeural',
    'tony':'en-US-TonyNeural',
    'nancy':'en-US-NancyNeural',
    'sara':'en-US-SaraNeural',
    'andrew':'en-US-AndrewNeural',
    'emma':'en-US-EmmaNeural',
    'brian':'en-US-BrianNeural',
    'british-male':'en-GB-RyanNeural',
    'british-female':'en-GB-SoniaNeural',
    'australian-male':'en-AU-WilliamNeural',
    'australian-female':'en-AU-NatashaNeural',
    'indian-male':'en-IN-PrabhatNeural',
    'indian-female':'en-IN-NeerjaNeural',
    'deep-male':'en-US-DavisNeural',
    'soft-female':'en-US-AriaNeural',
}

def _convert_to_wav(input_path,output_path):
    """Convert any audio format to WAV using ffmpeg."""
    import shutil
    ffmpeg=_find_ffmpeg()
    if ffmpeg:
        proc=subprocess.run([ffmpeg,'-y','-i',input_path,'-ar','22050','-ac','1','-sample_fmt','s16',output_path],capture_output=True,text=True,timeout=30)
        if proc.returncode!=0: raise ValueError(f'ffmpeg conversion failed: {proc.stderr[:300]}')
        return
    raise ValueError('ffmpeg is not installed. Install with: winget install ffmpeg')

def _resolve_voice(voice_key):
    """Resolve a voice key to an edge-tts voice name."""
    if not voice_key or voice_key=='default':
        return VOICE_PRESETS['default']
    if voice_key in VOICE_PRESETS:
        return VOICE_PRESETS[voice_key]
    # If it looks like a full edge-tts voice name, use it directly
    if '-' in voice_key and ('Neural' in voice_key or voice_key.count('-')>=2):
        return voice_key
    return VOICE_PRESETS.get(voice_key.lower(),VOICE_PRESETS['default'])

async def _edge_speak(text,voice,output_path):
    """Generate speech using edge-tts."""
    import edge_tts
    voice_name=_resolve_voice(voice)
    communicate=edge_tts.Communicate(text[:3000],voice_name)
    await communicate.save(output_path)

def _edge_speak_sync(text,voice,output_path):
    """Synchronous wrapper for edge-tts."""
    asyncio.run(_edge_speak(text,voice,output_path))

def _find_python311():
    """Find Python 3.11 for Coqui TTS (if installed)."""
    import shutil
    candidates=[
        r'C:\Program Files\Python311\python.exe',
        r'C:\Python311\python.exe',
        os.path.join(os.environ.get('LOCALAPPDATA',''), 'Programs', 'Python', 'Python311', 'python.exe'),
        shutil.which('python3.11'),
        shutil.which('python3.11.exe'),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None

def _find_ffmpeg():
    """Find ffmpeg executable."""
    import shutil
    candidates=[
        shutil.which('ffmpeg'),
    ]
    # Also search common install locations
    username=os.environ.get('USERNAME','')
    if username:
        candidates+=[
            rf'C:\Users\{username}\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe',
            rf'C:\Users\{username}\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin\ffmpeg.exe',
            rf'C:\Users\{username}\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-7.1.1-full_build\bin\ffmpeg.exe',
        ]
    candidates+=[
        r'C:\ffmpeg\bin\ffmpeg.exe',
        r'C:\Program Files\ffmpeg\bin\ffmpeg.exe',
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None

def _python_literal(value):
    """Return a Python-safe string literal for paths and other values."""
    return repr(str(value))

def _coqui_site_packages():
    """Find Python 3.11's site-packages for Coqui TTS."""
    py311=_find_python311()
    if py311:
        py_dir=Path(py311).parent
        candidate=py_dir / 'Lib' / 'site-packages'
        if candidate.exists():
            return str(candidate)
    # Fall back to current Python's site-packages
    return str(Path(sys.prefix) / 'Lib' / 'site-packages')

def _coqui_tts_command(text_file, ref_audio, wav_out):
    """Build a Coqui XTTS command with correctly escaped paths."""
    site_packages = _python_literal(_coqui_site_packages())
    return f'''
import sys
sys.path.insert(0,{site_packages})
from TTS.api import TTS
tts=TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cpu")
tts.tts_to_file(text_file={_python_literal(text_file)},speaker_wav={_python_literal(ref_audio)},language="en",file_path={_python_literal(wav_out)})
'''

def main(request):
    root=Path(request['models']);root.mkdir(parents=True,exist_ok=True)
    if request['action']=='setup':
        _ensure_package('huggingface_hub')
        from huggingface_hub import snapshot_download
        snapshot_download('Systran/faster-whisper-small',local_dir=str(root/'whisper-small'),allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.txt','preprocessor_config.json'])
        for name in ['kokoro-v1.0.onnx','voices-v1.0.bin']:
            target=root/name
            if not target.exists():
                temp=target.with_suffix('.download')
                urllib.request.urlretrieve('https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'+name,str(temp));temp.replace(target)
        return {'ready':True}
    if request['action']=='setup_xtts':
        py311=_find_python311()
        if py311:
            subprocess.run([py311,'-m','pip','install','TTS','--quiet'],capture_output=True,timeout=300)
            return {'ready':True,'pythonPath':py311}
        return {'ready':False,'error':'Python 3.11 not found. Install Python 3.11 for voice cloning support: https://www.python.org/downloads/release/python-3119/'}
    if request['action']=='transcribe':
        _ensure_package('faster-whisper')
        _ensure_package('av')
        from faster_whisper import WhisperModel
        import av
        with av.open(request['input']) as audio:
            duration=audio.duration/av.time_base if audio.duration else 0
            if duration>65: raise ValueError('Recording exceeds 60 seconds')
        model=WhisperModel(str(root/'whisper-small'),device='cpu',compute_type='int8',local_files_only=True,cpu_threads=4)
        segments,_=model.transcribe(request['input'],beam_size=3,vad_filter=True)
        return {'text':' '.join(segment.text.strip() for segment in segments)[:6000]}
    if request['action']=='speak':
        voice_profile=request.get('voiceProfile')
        # Check if it's a Coqui voice profile (directory with ref.wav)
        if voice_profile and Path(voice_profile).is_dir() and (Path(voice_profile)/'ref.wav').exists():
            return _speak_coqui(root,request['text'],request['output'],voice_profile)
        # Use edge-tts
        voice_key=request.get('voicePreset','default')
        _edge_speak_sync(request['text'],voice_key,request['output'])
        return {'output':request['output']}
    if request['action']=='speak_mp3':
        voice_profile=request.get('voiceProfile')
        texts=request.get('texts',[]) or [request.get('text','')]
        import shutil,tempfile
        # Check if it's a Coqui voice profile
        if voice_profile and Path(voice_profile).is_dir() and (Path(voice_profile)/'ref.wav').exists():
            return _speak_mp3_coqui(root,texts,request['output'],voice_profile)
        # Use edge-tts for each text, concatenate with ffmpeg
        voice_key=request.get('voicePreset','default')
        ffmpeg=_find_ffmpeg()
        if not ffmpeg: raise ValueError('ffmpeg is not installed. Install with: winget install ffmpeg')
        tmpdir=tempfile.mkdtemp()
        mp3_files=[]
        try:
            for i,t in enumerate(texts):
                if not t: continue
                part_path=os.path.join(tmpdir,f'part_{i}.mp3')
                _edge_speak_sync(t,voice_key,part_path)
                mp3_files.append(part_path)
            if not mp3_files: raise ValueError('No text provided for synthesis')
            if len(mp3_files)==1:
                shutil.move(mp3_files[0],request['output'])
            else:
                concat_file=os.path.join(tmpdir,'concat.txt')
                with open(concat_file,'w') as f:
                    for mf in mp3_files:
                        f.write(f"file '{mf}'\n")
                proc=subprocess.run([ffmpeg,'-y','-f','concat','-safe','0','-i',concat_file,'-codec:a','libmp3lame','-q:a','2',request['output']],capture_output=True,text=True,timeout=120)
                if proc.returncode!=0: raise ValueError(f'ffmpeg concat failed: {proc.stderr[:300]}')
            return {'output':request['output']}
        finally:
            try: shutil.rmtree(tmpdir)
            except: pass
    if request['action']=='list_voices':
        voices=[{'id':k,'name':v,'type':'preset'} for k,v in VOICE_PRESETS.items()]
        # Also list saved Coqui voice profiles
        profiles_dir=root/'voice-profiles'
        if profiles_dir.exists():
            import json as _json
            for d in profiles_dir.iterdir():
                if d.is_dir():
                    meta_file=d/'meta.json'
                    if meta_file.exists():
                        try:
                            with open(meta_file) as f: meta=_json.load(f)
                            meta['type']='cloned'
                            meta['path']=str(d)
                            meta['hasRef']=(d/'ref.wav').exists()
                            voices.append(meta)
                        except: pass
        return {'voices':voices}
    if request['action']=='train_voice':
        return _train_voice(root,request)
    if request['action']=='delete_voice':
        return _delete_voice(root,request['voiceId'])
    raise ValueError('Unknown voice action')

def _speak_coqui(root,text,output_path,voice_profile):
    """Use Coqui TTS with a cloned voice via Python 3.11."""
    py311=_find_python311()
    if not py311: raise ValueError('Python 3.11 not found for voice cloning.')
    ref_audio=str(Path(voice_profile)/'ref.wav')
    import tempfile
    tmpdir=tempfile.mkdtemp()
    wav_out=os.path.join(tmpdir,'output.wav')
    text_file=os.path.join(tmpdir,'text.txt')
    with open(text_file,'w',encoding='utf-8') as f: f.write(text[:3000])
    try:
        cmd=[py311,'-c',_coqui_tts_command(text_file, ref_audio, wav_out)]
        env={**os.environ,'COQUI_TOS_AGREED':'1'}
        proc=subprocess.run(cmd,capture_output=True,text=True,timeout=300,env=env)
        if proc.returncode!=0 or not Path(wav_out).exists():
            raise ValueError(f'Coqui TTS failed: {proc.stderr[:500]}')
        import shutil
        shutil.move(wav_out,output_path)
        return {'output':output_path}
    finally:
        try: import shutil; shutil.rmtree(tmpdir)
        except: pass

def _speak_mp3_coqui(root,texts,output_path,voice_profile):
    """Use Coqui TTS for multiple texts, convert to MP3."""
    import shutil,tempfile
    ffmpeg=_find_ffmpeg()
    if not ffmpeg: raise ValueError('ffmpeg is not installed.')
    py311=_find_python311()
    if not py311: raise ValueError('Python 3.11 not found for voice cloning.')
    ref_audio=str(Path(voice_profile)/'ref.wav')
    tmpdir=tempfile.mkdtemp()
    wav_files=[]
    try:
        for i,t in enumerate(texts):
            if not t: continue
            wav_out=os.path.join(tmpdir,f'part_{i}.wav')
            text_file=os.path.join(tmpdir,f'text_{i}.txt')
            with open(text_file,'w',encoding='utf-8') as f: f.write(t[:3000])
            cmd=[py311,'-c',_coqui_tts_command(text_file, ref_audio, wav_out)]
            env={**os.environ,'COQUI_TOS_AGREED':'1'}
            proc=subprocess.run(cmd,capture_output=True,text=True,timeout=300,env=env)
            if proc.returncode!=0 or not Path(wav_out).exists():
                raise ValueError(f'Coqui TTS failed: {proc.stderr[:500]}')
            wav_files.append(wav_out)
        if not wav_files: raise ValueError('No text provided.')
        concat_file=os.path.join(tmpdir,'concat.txt')
        with open(concat_file,'w') as f:
            for wf in wav_files: f.write(f"file '{wf}'\n")
        proc=subprocess.run([ffmpeg,'-y','-f','concat','-safe','0','-i',concat_file,'-codec:a','libmp3lame','-q:a','2',output_path],capture_output=True,text=True,timeout=120)
        if proc.returncode!=0: raise ValueError(f'ffmpeg concat failed: {proc.stderr[:300]}')
        return {'output':output_path}
    finally:
        try: shutil.rmtree(tmpdir)
        except: pass

def _train_voice(root,request):
    """Train a voice profile from reference audio using Coqui TTS via Python 3.11."""
    py311=_find_python311()
    if not py311: raise ValueError('Python 3.11 not found. Install Python 3.11 for voice cloning: https://www.python.org/downloads/release/python-3119/')
    profiles_dir=root/'voice-profiles'
    profiles_dir.mkdir(parents=True,exist_ok=True)
    voice_id=request.get('voiceId','custom-'+str(int(__import__('time').time())))
    voice_dir=profiles_dir/voice_id
    voice_dir.mkdir(parents=True,exist_ok=True)
    ref_input=request['refAudio']
    ref_wav=str(voice_dir/'ref.wav')
    _convert_to_wav(ref_input,ref_wav)
    # Verify it works by doing a quick TTS test
    test_cmd=[py311, '-c', f'''
import sys
sys.path.insert(0,{_python_literal(_coqui_site_packages())})
from TTS.api import TTS
tts=TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cpu")
tts.tts_to_file(text="Test.",speaker_wav={_python_literal(ref_wav)},language="en",file_path={_python_literal(f"{ref_wav}.test.wav")})
import os; os.remove({ _python_literal(f"{ref_wav}.test.wav") })
print("OK")
''']
    env={**os.environ,'COQUI_TOS_AGREED':'1'}
    proc=subprocess.run(test_cmd,capture_output=True,text=True,timeout=300,env=env)
    if proc.returncode!=0:
        import shutil
        shutil.rmtree(str(voice_dir))
        raise ValueError(f'Voice training failed: {proc.stderr[:500]}')
    # Save metadata
    import json as _json
    meta={'id':voice_id,'name':request.get('voiceName',voice_id),'createdAt':__import__('time').time(),'method':'coqui-xtts-v2'}
    with open(voice_dir/'meta.json','w') as f: _json.dump(meta,f)
    return {'voiceId':voice_id,'name':meta['name'],'path':str(voice_dir)}

def _delete_voice(root,voice_id):
    """Delete a voice profile."""
    profiles_dir=root/'voice-profiles'
    voice_dir=profiles_dir/voice_id
    if voice_dir.exists():
        import shutil
        shutil.rmtree(str(voice_dir))
    return {'deleted':voice_id}

if __name__=='__main__':
    try: print(json.dumps(main(json.load(sys.stdin)),ensure_ascii=False))
    except Exception as e: print(json.dumps({'error':str(e)}));sys.exit(1)
