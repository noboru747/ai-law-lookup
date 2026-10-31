# Start the local generation service on 127.0.0.1:8790 (Ollama must be running on :11434).
Set-Location $PSScriptRoot
python -m pip install -q -r requirements.txt
python -m app
