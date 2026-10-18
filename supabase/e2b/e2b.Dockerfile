# 시험용 샌드박스 템플릿.
#
# 응시 중 외부 송신은 차단된다(_shared/sandbox.ts 의 networkPolicy). 그래서
# 응시자가 쓸 것은 전부 이 이미지 안에 미리 있어야 한다. 시험 중에 네트워크로
# 받아 쓰게 두면 "패키지 설치"와 "검색해서 베끼기"를 구분할 수 없다.
#
# 빌드(로컬에서 1회, E2B API 키 필요):
#   npm i -g @e2b/cli
#   e2b auth login
#   cd supabase/e2b && e2b template build -c "/root/.jupyter/start-up.sh" --name hrd-exam
# 빌드가 끝나면 출력된 템플릿 ID 를 엣지 함수 시크릿 E2B_TEMPLATE 에 넣는다.

FROM e2bdev/code-interpreter:latest

# 한글 폰트. 이게 없으면 matplotlib 차트의 한글 라벨이 전부 두부(□)로 나온다 —
# 산출물 규격을 지켰는지 채점하는 문항(CAPD-02)에서 바로 문제가 된다.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-nanum fonts-nanum-coding \
  && fc-cache -fv \
  && rm -rf /var/lib/apt/lists/*

# 응시에 필요한 패키지. 버전을 고정해 회차마다 환경이 달라지지 않게 한다 —
# 같은 답안이 회차에 따라 다르게 채점되면 평가가 아니다.
RUN pip install --no-cache-dir \
      pandas==2.2.3 \
      numpy==2.1.3 \
      matplotlib==3.9.2 \
      openpyxl==3.1.5 \
      python-docx==1.1.2 \
      tabulate==0.9.0

# matplotlib 기본 폰트를 나눔고딕으로. 응시자가 폰트 설정을 몰라도 한글이 나온다.
RUN python -c "import matplotlib; print(matplotlib.matplotlib_fname())" > /tmp/mplrc_path \
  && MPLRC=$(cat /tmp/mplrc_path) \
  && printf '\nfont.family: NanumGothic\naxes.unicode_minus: False\n' >> "$MPLRC" \
  && rm -f /tmp/mplrc_path

# 응시자 작업 폴더. sandbox.ts 의 WORK_DIR 과 같아야 한다.
RUN mkdir -p /home/user/work
