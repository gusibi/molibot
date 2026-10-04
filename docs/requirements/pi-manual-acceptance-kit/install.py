"""Copy synthetic acceptance files into a selected workspace without overwriting."""
import shutil
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 install.py TEST_WORKSPACE')
workspace = Path(sys.argv[1]).expanduser().resolve()
if not workspace.is_dir():
    raise SystemExit('Choose an existing test workspace directory')
destination = workspace / 'acceptance'
if destination.exists():
    raise SystemExit('Refusing to overwrite existing acceptance directory; choose a fresh test workspace')
shutil.copytree(Path(__file__).parent / 'acceptance', destination)
print(f'Installed synthetic test files in {destination}')
