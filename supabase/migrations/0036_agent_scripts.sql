-- 0036_agent_scripts.sql
--
-- 에이전트가 샌드박스 안에서 실행하는 스크립트를 담는다.
-- 생성 파일이다 — 원본은 supabase/fixtures/fixtures.py 이고, 고친 뒤 다시 만든다:
--   node scripts/gen-fixture-module.mjs > supabase/migrations/0036_agent_scripts.sql
--
-- 왜 테이블인가: 엣지 함수 번들에 14KB 파이썬을 굽지 않기 위해서다. 픽스처를
-- 고칠 때 함수를 다시 배포하지 않아도 되고, 배포 페이로드도 작아진다.
--
-- 조직 자산이 아니라 플랫폼 운영 자산이므로 org_id 를 두지 않는다
-- (테넌시 가드 예외 목록에 등록한다). 읽기는 service_role 전용 —
-- 이 스크립트에는 심어 둔 결함의 위치, 즉 채점 기준이 들어 있다.

create table if not exists public.agent_scripts (
  name       text primary key,
  content    text not null,
  updated_at timestamptz not null default now(),
  constraint agent_scripts_content_not_blank check (length(btrim(content)) > 0)
);

comment on table public.agent_scripts is
  '에이전트가 샌드박스에서 실행하는 스크립트. 채점 기준(심어 둔 결함 위치)이 들어 있어 service_role 만 읽는다.';

alter table public.agent_scripts enable row level security;

-- Supabase default privileges 가 anon·authenticated 에 ALL 을 준다(0030 참고).
-- 정책을 두지 않는 것만으로는 막히지 않으므로 권한을 회수한다.
revoke all on public.agent_scripts from anon, authenticated;
grant all on public.agent_scripts to service_role;
-- 정책을 두지 않는다 — service_role 외 전면 거부.

insert into public.agent_scripts (name, content) values ('fixtures.py', $py$#!/usr/bin/env python3
# 문항 실습 데이터 생성기 — 샌드박스 안에서 실행된다.
#
# 이 파일이 원본이다. supabase/functions/_shared/fixtureScript.ts 는 생성 파일이며
# 여기를 고친 뒤 다시 만든다:
#   node scripts/gen-fixture-module.mjs
#
# 표준 라이브러리만 쓴다 — 커스텀 템플릿이 아직 없는 환경(base 이미지)에서도
# 픽스처는 나와야 한다.
#
# 심어 둔 결함(중복·결측·형식 오류·분석 오류)은 채점 기준이다. 이 파일은 샌드박스
# 작업 폴더 밖에서 실행하고 바로 지운다 — 응시자가 읽으면 정답을 넘겨주는 셈이다.
#
# 사용: python3 fixtures.py <문항코드> [시드] [출력폴더]
import sys, os, io, datetime

CODE = sys.argv[1]
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 20260101
OUT  = sys.argv[3] if len(sys.argv) > 3 else "."

class R:
    """고정 시드 선형합동생성기. 파이썬 버전과 무관하게 같은 값이 나온다.

    LCG 의 하위 비트는 주기가 짧아 % 100 같은 연산이 거의 고정된 값을 낸다
    (3% 확률로 심으려던 결측이 2225행에서 1건만 나왔다). 상위 비트만 쓴다.
    """
    def __init__(self, seed): self.s = seed & 0x7FFFFFFF or 1
    def next(self):
        self.s = (self.s * 1103515245 + 12345) & 0x7FFFFFFF
        return self.s >> 15
    def i(self, a, b): return a + self.next() % (b - a + 1)
    def pick(self, xs): return xs[self.next() % len(xs)]
    def chance(self, pct): return self.next() % 100 < pct

def write(name, text):
    p = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("wrote %s (%d bytes)" % (name, len(text.encode("utf-8"))))

# ---------------------------------------------------------------------------
# CAPA-01 낯선 형식의 접속 로그. 특정 시간대에 오류율이 치솟는다.
# ---------------------------------------------------------------------------
def capa01(r):
    paths = ["/api/orders", "/api/orders/search", "/api/login", "/api/report",
             "/static/app.js", "/api/users/me", "/api/payment/confirm"]
    uas = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
           "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
           "okhttp/4.12.0", "curl/8.5.0"]
    base = datetime.datetime(2026, 3, 9, 0, 0, 0)
    lines = []
    for n in range(20000):
        t = base + datetime.timedelta(seconds=int(n * 30.24))
        hour = t.hour + (t - base).days * 24
        # 3월 11일 14~16시에 장애 조짐: 5xx 비율이 2% → 30% 대로 뛴다.
        spike = (t.month == 3 and t.day == 11 and 14 <= t.hour < 16)
        err_pct = 30 if spike else 2
        if r.chance(err_pct):
            status = r.pick([500, 502, 503, 504])
            ms = r.i(3000, 29000)
        else:
            status = r.pick([200, 200, 200, 200, 201, 204, 304, 400, 401, 404])
            ms = r.i(12, 480)
        ip = "10.%d.%d.%d" % (r.i(0, 3), r.i(0, 255), r.i(1, 254))
        stamp = t.strftime("%d/%b/%Y:%H:%M:%S +0900")
        lines.append('%s - - [%s] "%s %s HTTP/1.1" %d %d %dms "-" "%s"'
                     % (ip, stamp, r.pick(["GET", "GET", "POST"]), r.pick(paths),
                        status, r.i(120, 48000), ms, r.pick(uas)))
    write("access_log.txt", "\n".join(lines) + "\n")

# ---------------------------------------------------------------------------
# CAPC-01 거래 명세 12개 파일. 열 이름이 파일마다 다르고 결함이 섞여 있다.
# ---------------------------------------------------------------------------
def capc01(r):
    # 같은 뜻인데 표기가 다르다. 응시자가 매핑을 스스로 세워야 한다.
    headers = [
        ["거래일자", "거래처명", "품목", "수량", "금액"],
        ["일자", "거래처", "품목명", "수량", "공급가액"],
        ["date", "vendor", "item", "qty", "amount"],
        ["거래일", "업체명", "품목", "수량", "금액(원)"],
    ]
    vendors = ["가온상사", "나래물산", "다온테크", "라온유통", "마중물산업",
               "바로텍", "사계유통", "아침해상사"]
    items = ["A4용지", "토너", "노트북 거치대", "회의용 의자", "USB 허브",
             "모니터암", "화이트보드", "전원 멀티탭"]
    for m in range(1, 13):
        h = headers[(m - 1) % len(headers)]
        rows = [",".join(h)]
        prev = None
        for i in range(r.i(140, 220)):
            d = datetime.date(2026, m, r.i(1, 28))
            # 날짜 형식도 파일마다 다르고, 일부 행은 아예 형식이 깨져 있다.
            if r.chance(4):
                ds = "%d.%d.%d" % (d.year, d.month, d.day)     # 형식 오류
            elif m % 3 == 0:
                ds = d.strftime("%Y/%m/%d")
            else:
                ds = d.strftime("%Y-%m-%d")
            amt = "" if r.chance(3) else str(r.i(1, 400) * 1000)  # 금액 누락
            row = ",".join([ds, r.pick(vendors), r.pick(items), str(r.i(1, 60)), amt])
            rows.append(row)
            # 같은 행을 그대로 한 번 더 — 중복
            if prev and r.chance(3):
                rows.append(prev)
            prev = row
        write("input/거래명세_2026-%02d.csv" % m, "\n".join(rows) + "\n")
    write("input/README.txt",
          "매달 거래처에서 받는 명세 파일입니다.\n"
          "담당자는 지금 12개 파일을 하나씩 열어 양식을 맞추고 합친 뒤\n"
          "눈으로 오류를 찾습니다.\n")

# ---------------------------------------------------------------------------
# CAPC-02 부서별 집계 원본 7개 + 현재 수작업 절차서.
# ---------------------------------------------------------------------------
def capc02(r):
    depts = ["기획조정", "경영지원", "영업1", "영업2", "생산관리", "품질보증", "연구개발"]
    for d in depts:
        rows = ["항목,1월,2월,3월,비고"]
        for name in ["매출", "매출원가", "판관비", "인건비", "교육비", "출장비"]:
            vals = [str(r.i(50, 900) * 10000) for _ in range(3)]
            # 일부 셀은 숫자가 아니라 메모가 들어 있다 — 손으로 고쳐 온 흔적
            if r.chance(15):
                vals[r.i(0, 2)] = "확인중"
            rows.append(",".join([name] + vals + [""]))
        write("input/%s_2026Q1.csv" % d, "\n".join(rows) + "\n")
    write("현재_절차_설명서.md", """# 분기 집계표 작성 절차 (현재)

분기마다 아래 순서로 손으로 만듭니다. 한 번에 3~4시간 걸립니다.

1. 부서 7곳에서 받은 파일을 하나씩 엽니다.
2. 항목 순서를 기준 양식(매출·매출원가·판관비·인건비·교육비·출장비)에 맞춥니다.
3. 1~3월 값을 합쳐 분기 합계 열을 만듭니다.
4. 숫자가 아닌 셀("확인중" 등)은 담당 부서에 전화해 확인한 뒤 채웁니다.
5. 부서 합계와 전사 합계를 맞춰 보고, 어긋나면 2번으로 돌아갑니다.
6. 전분기 대비 증감률을 계산해 비고에 적습니다.
7. 증감률이 ±30% 를 넘는 항목은 반드시 담당자 확인을 받습니다.

## 지난 분기에 있었던 일
- 영업2 파일의 2월 인건비가 "확인중" 이었는데 0 으로 처리해 전사 합계가 틀렸습니다.
- 연구개발 교육비가 전분기 대비 +180% 였는데 확인 없이 올라가 보고 후 정정했습니다.
""")

# ---------------------------------------------------------------------------
# CAPD-02 원시 데이터 + 결과물 규격. 규격 준수 여부가 채점 핵심이다.
# ---------------------------------------------------------------------------
def capd02(r):
    regions = ["서울", "경기", "인천", "부산", "대구", "광주", "대전"]
    chans = ["온라인", "대리점", "직영"]
    rows = ["지역,채널,월,건수,금액"]
    for reg in regions:
        for ch in chans:
            for m in range(1, 13):
                rows.append("%s,%s,%d,%d,%d" % (reg, ch, m, r.i(20, 480), r.i(300, 9800) * 1000))
    write("sales_2026.csv", "\n".join(rows) + "\n")
    write("결과물_규격.md", """# 산출물 규격

아래 규격을 **그대로** 지켜 주십시오. 규격과 다르게 만든 부분이 있으면
그 이유를 `사유.md` 에 적어 주십시오.

## 1. 차트 — `chart.png`
- 종류: 가로 막대(barh). 세로 막대 아님.
- Y축: 지역 7개. 금액 합계 **내림차순**(위에서 아래로 큰 값).
- X축: 금액 합계. 단위는 **백만원**, 축 라벨에 "(백만원)" 표기.
- 색 구분: 채널별로 색을 나눠 **누적 막대**로 그린다. 범례를 오른쪽 아래에 둔다.
- 제목: `2026년 지역·채널별 매출`
- 크기: 가로 10인치 × 세로 6인치, 해상도 150dpi.

## 2. 표 — `summary.csv`
- 열 순서: `지역,온라인,대리점,직영,합계`
- 값은 금액 합계를 **백만원 단위로 소수점 첫째 자리까지** 반올림.
- 행 순서: 합계 내림차순.
- 마지막 행에 `전체` 행을 둔다.

## 3. 파일 형식
- 차트는 PNG, 표는 UTF-8 CSV.
- 두 파일을 만든 코드도 함께 제출한다(`make_report.py` 등).
""")

# ---------------------------------------------------------------------------
# CAPE-02 분석 코드 + 결과 + 보고 문장. 결론이 어긋나는 지점이 심어져 있다.
# ---------------------------------------------------------------------------
def cape02(r):
    # 설문 응답. 만족도 1~5. 미응답은 공백.
    #
    # 심은 결함은 두 개이고, 방향이 같아야 한다.
    #   (1) analysis.py 가 '해지고객' 을 표본에서 빼 버린다 → 평균이 올라간다.
    #   (2) 미응답을 0 점으로 채운다 → 평균이 내려간다.
    # 둘이 비슷한 크기면 서로 상쇄돼 결론이 안 바뀌고, 그러면 "어디서부터
    # 결론이 어긋나는지 찾아라"는 문항이 성립하지 않는다(처음 만든 데이터가
    # 실제로 3.70 vs 3.69 로 같아서 못 쓰는 상태였다).
    # 그래서 (1)을 지배적 결함으로 만든다: 해지고객 비중을 키우고 만족도를
    # 뚜렷하게 낮게 두며, 미응답은 해지고객에 몰아 둔다. 해지고객을 빼면
    # 미응답도 대부분 함께 빠져 (2)의 효과가 작아진다.
    rows = ["응답ID,가입구분,지역,만족도,재구매의향"]
    for i in range(1, 1201):
        kind = "해지고객" if r.chance(35) else "유지고객"
        if kind == "해지고객":
            sat = "" if r.chance(35) else str(r.i(1, 2))
        else:
            sat = "" if r.chance(5) else str(r.i(3, 5) if r.chance(25) else r.i(4, 5))
        rows.append("R%04d,%s,%s,%s,%s" % (
            i, kind, r.pick(["서울", "경기", "부산", "대구", "기타"]),
            sat, "아니오" if kind == "해지고객" else r.pick(["예", "예", "아니오"])))
    write("survey.csv", "\n".join(rows) + "\n")

    write("analysis.py", '''# 고객 만족도 분석 (전임자 작성)
import csv

rows = list(csv.DictReader(open("survey.csv", encoding="utf-8")))

# 해지한 고객은 더 이상 우리 고객이 아니므로 제외한다
rows = [r for r in rows if r["가입구분"] != "해지고객"]

# 미응답은 0 점으로 처리한다
scores = [int(r["만족도"]) if r["만족도"] else 0 for r in rows]

avg = sum(scores) / len(scores)
print("표본 수:", len(scores))
print("평균 만족도: %.2f" % avg)

high = len([s for s in scores if s >= 4])
print("4점 이상 비율: %.1f%%" % (100.0 * high / len(scores)))
''')

    # 실행결과·보고문장의 수치는 analysis.py 가 실제로 내는 값이어야 한다.
    # 하드코딩하면 응시자가 재실행했을 때 숫자가 달라 "뭘 대조해야 하는지"가
    # 흐려진다. 전임자의 잘못된 분석을 그대로 재현해 값을 구한다.
    kept = [x for x in rows[1:] if x.split(",")[1] != "해지고객"]
    sc = [int(x.split(",")[3]) if x.split(",")[3] else 0 for x in kept]
    avg = sum(sc) / float(len(sc))
    hi = len([v for v in sc if v >= 4]) * 100.0 / len(sc)

    write("실행결과.txt",
          "표본 수: %d\n평균 만족도: %.2f\n4점 이상 비율: %.1f%%\n" % (len(sc), avg, hi))

    write("보고문장.md", """# 고객 만족도 조사 결과 (초안)

조사 결과 평균 만족도는 **%.2f점**(5점 만점)으로 나타났으며, 4점 이상
응답 비율은 **%.1f%%** 였습니다. 전반적으로 만족도가 양호한 수준으로
판단되며, 현재의 서비스 품질을 유지하는 것이 적절하다고 보입니다.

별도의 개선 과제는 도출되지 않았습니다.
""" % (avg, hi))

MAP = {
    "CAPA-01": capa01,
    "CAPC-01": capc01,
    "CAPC-02": capc02,
    "CAPD-02": capd02,
    "CAPE-02": cape02,
}

fn = MAP.get(CODE)
if fn is None:
    print("no fixture for %s" % CODE)
else:
    fn(R(SEED))
    print("fixture ready: %s" % CODE)
$py$)
on conflict (name) do update
  set content = excluded.content, updated_at = now();
