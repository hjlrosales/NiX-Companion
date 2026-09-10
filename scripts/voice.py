import json,sys,os,urllib.request
from pathlib import Path
os.environ['ONNX_PROVIDER']='CPUExecutionProvider'
def main(request):
    root=Path(request['models']);root.mkdir(parents=True,exist_ok=True)
    if request['action']=='setup':
        from huggingface_hub import snapshot_download
        snapshot_download('Systran/faster-whisper-small',local_dir=str(root/'whisper-small'),allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.txt','preprocessor_config.json'])
        for name in ['kokoro-v1.0.onnx','voices-v1.0.bin']:
            target=root/name
            if not target.exists():
                temp=target.with_suffix('.download')
                urllib.request.urlretrieve('https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'+name,str(temp));temp.replace(target)
        return {'ready':True}
    if request['action']=='transcribe':
        from faster_whisper import WhisperModel
        import av
        with av.open(request['input']) as audio:
            duration=audio.duration/av.time_base if audio.duration else 0
            if duration>65: raise ValueError('Recording exceeds 60 seconds')
        model=WhisperModel(str(root/'whisper-small'),device='cpu',compute_type='int8',local_files_only=True,cpu_threads=4)
        segments,_=model.transcribe(request['input'],beam_size=3,vad_filter=True)
        return {'text':' '.join(segment.text.strip() for segment in segments)[:6000]}
    if request['action']=='speak':
        from kokoro_onnx import Kokoro
        import soundfile as sf
        model=Kokoro(str(root/'kokoro-v1.0.onnx'),str(root/'voices-v1.0.bin'))
        samples,rate=model.create(request['text'][:3000],voice='af_sarah',speed=1.0,lang='en-us')
        sf.write(request['output'],samples,rate);return {'output':request['output']}
    raise ValueError('Unknown voice action')
if __name__=='__main__':
    try: print(json.dumps(main(json.load(sys.stdin)),ensure_ascii=False))
    except Exception as e: print(json.dumps({'error':str(e)}));sys.exit(1)
