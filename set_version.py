#!/usr/bin/env python3
"""
VERSION 파일의 버전 번호를 manifest.json에 반영.

사용법:
  python set_version.py          # VERSION 파일 → manifest.json 동기화
  python set_version.py 1.2.3    # 버전 지정 → VERSION + manifest.json 동시 업데이트
"""

import sys
import json
import re
from pathlib import Path

BASE = Path(__file__).parent
VERSION_FILE = BASE / 'VERSION'
MANIFEST_FILE = BASE / 'manifest.json'


def read_version():
    return VERSION_FILE.read_text(encoding='utf-8').strip()


def validate_version(v):
    if not re.fullmatch(r'\d+\.\d+\.\d+(\.\d+)?', v):
        raise ValueError(f'버전 형식이 올바르지 않습니다: "{v}" (예: 1.2.3 또는 1.2.3.4)')


def apply_version(version):
    validate_version(version)

    # VERSION 파일 업데이트
    VERSION_FILE.write_text(version + '\n', encoding='utf-8')

    # manifest.json 업데이트
    manifest = json.loads(MANIFEST_FILE.read_text(encoding='utf-8'))
    old = manifest.get('version', '?')
    manifest['version'] = version
    MANIFEST_FILE.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8'
    )

    print(f'버전 업데이트: {old} → {version}')
    print(f'  VERSION      : {VERSION_FILE}')
    print(f'  manifest.json: {MANIFEST_FILE}')


if __name__ == '__main__':
    if len(sys.argv) == 2:
        apply_version(sys.argv[1])
    elif len(sys.argv) == 1:
        version = read_version()
        apply_version(version)
    else:
        print('사용법: python set_version.py [버전]')
        sys.exit(1)
