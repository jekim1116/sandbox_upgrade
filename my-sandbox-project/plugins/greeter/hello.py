import sys
import numpy as np
import pandas as pd
import requests
from bs4 import BeautifulSoup

if len(sys.argv) < 2:
    print("사용법: python3 hello.py [이름]")
    sys.exit(1)

name = sys.argv[1]
print(f"안녕하세요, {name}님! 파이썬 샌드박스에서 인사드립니다.")
